package dev.pennyvoice;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import java.security.*;
import java.time.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    public record Credentials(@NotBlank @Email @Size(max = 254) String email, @NotNull @Size(min = 12, max = 72) String password) {}
    public record User(UUID id, String email) {}
    public record Session(User user, String accessToken, Instant expiresAt) {}
    private record Refresh(User user, UUID family, Instant expires, Instant rotated) {}
    private record Account(UUID id, String email, String passwordHash) {}
    private final JdbcClient jdbc;
    private final PasswordEncoder passwords;
    private final JwtEncoder encoder;
    private final TransactionTemplate transactions;
    private final boolean secure;
    private final SecretKey jwtKey;
    private final String dummyHash;
    private final SecureRandom random = new SecureRandom();
    public AuthController(JdbcClient jdbc, PasswordEncoder passwords, JwtEncoder encoder, TransactionTemplate transactions, SecretKey jwtKey, @Value("${pennyvoice.cookie-secure}") boolean secure) {
        this.jdbc = jdbc; this.passwords = passwords; this.encoder = encoder; this.transactions = transactions; this.secure = secure; this.jwtKey = jwtKey;
        dummyHash = passwords.encode(UUID.randomUUID().toString());
    }
    @GetMapping("/csrf") public CsrfToken csrf(CsrfToken token) { return token; }
    private String email(Credentials credentials) { return credentials.email().strip().toLowerCase(Locale.ROOT); }
    private void checkPassword(Credentials credentials) {
        if (credentials.password().getBytes(StandardCharsets.UTF_8).length > 72) throw new ResponseStatusException(BAD_REQUEST, "Password must be at most 72 UTF-8 bytes");
    }
    @PostMapping("/register") @ResponseStatus(CREATED)
    public Session register(@Valid @RequestBody Credentials credentials, HttpServletResponse response) {
        checkPassword(credentials);
        User user = new User(UUID.randomUUID(), email(credentials));
        String hash = passwords.encode(credentials.password());
        try {
            return transactions.execute(status -> {
                jdbc.sql("INSERT INTO app_user (id, email, password_hash) VALUES (:id, :email, :hash)")
                    .param("id", user.id()).param("email", user.email()).param("hash", hash).update();
                return newSession(user, response);
            });
        } catch (DuplicateKeyException error) { throw new ResponseStatusException(CONFLICT, "Unable to create account with these details"); }
    }
    @PostMapping("/login")
    public Session login(@Valid @RequestBody Credentials credentials, HttpServletResponse response) {
        checkPassword(credentials);
        var account = jdbc.sql("SELECT id, email, password_hash FROM app_user WHERE email = :email").param("email", email(credentials)).query(Account.class).optional();
        boolean matches = passwords.matches(credentials.password(), account.map(Account::passwordHash).orElse(dummyHash));
        if (account.isEmpty() || !matches) throw new ResponseStatusException(UNAUTHORIZED, "Email or password is incorrect");
        return transactions.execute(status -> newSession(new User(account.get().id(), account.get().email()), response));
    }
    @PostMapping("/refresh")
    public Session refresh(@CookieValue(name = "pv_refresh", defaultValue = "") String token, HttpServletResponse response) {
        if (token.isBlank()) throw new ResponseStatusException(UNAUTHORIZED, "Sign in required");
        Session session = transactions.execute(status -> {
            var row = jdbc.sql("SELECT u.id, u.email, s.family_id, s.expires_at, s.rotated_at FROM refresh_session s JOIN app_user u ON u.id = s.user_id WHERE s.token_hash = :hash AND s.expires_at > CURRENT_TIMESTAMP FOR UPDATE OF s")
                .param("hash", hash(token)).query((rs, index) -> new Refresh(new User(rs.getObject("id", UUID.class), rs.getString("email")), rs.getObject("family_id", UUID.class), rs.getTimestamp("expires_at").toInstant(), rs.getTimestamp("rotated_at") == null ? null : rs.getTimestamp("rotated_at").toInstant())).optional();
            if (row.isEmpty()) return null;
            Refresh previous = row.get();
            String next = replacement(token);
            if (previous.rotated() != null) {
                if (previous.rotated().isBefore(Instant.now().minusSeconds(30))) return null;
                boolean active = jdbc.sql("SELECT EXISTS(SELECT 1 FROM refresh_session WHERE token_hash=:hash AND family_id=:family AND rotated_at IS NULL AND expires_at > CURRENT_TIMESTAMP)")
                    .param("hash", hash(next)).param("family", previous.family()).query(Boolean.class).single();
                if (!active) return null;
            } else {
                jdbc.sql("UPDATE refresh_session SET rotated_at=CURRENT_TIMESTAMP WHERE token_hash=:hash").param("hash", hash(token)).update();
                storeRefresh(previous.user(), next, previous.family(), previous.expires());
            }
            // A short deterministic retry window avoids losing login if the rotated cookie response is lost.
            cookie(response, next, Duration.between(Instant.now(), previous.expires()));
            return accessSession(previous.user());
        });
        if (session == null) throw new ResponseStatusException(UNAUTHORIZED, "Session expired");
        return session;
    }
    @PostMapping("/logout") @ResponseStatus(NO_CONTENT)
    public void logout(@CookieValue(name = "pv_refresh", defaultValue = "") String token, HttpServletResponse response) {
        transactions.executeWithoutResult(status -> {
            var family = jdbc.sql("SELECT family_id FROM refresh_session WHERE token_hash=:hash FOR UPDATE").param("hash", hash(token)).query(UUID.class).optional();
            family.ifPresent(id -> jdbc.sql("DELETE FROM refresh_session WHERE family_id=:family").param("family", id).update());
        });
        cookie(response, "", Duration.ZERO);
    }
    private Session newSession(User user, HttpServletResponse response) {
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        String refresh = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiry = Instant.now().plus(Duration.ofDays(30));
        jdbc.sql("DELETE FROM refresh_session WHERE expires_at < CURRENT_TIMESTAMP OR rotated_at < CURRENT_TIMESTAMP - INTERVAL '30 seconds'").update();
        storeRefresh(user, refresh, UUID.randomUUID(), expiry);
        cookie(response, refresh, Duration.ofDays(30));
        return accessSession(user);
    }
    private void storeRefresh(User user, String token, UUID family, Instant expiry) {
        jdbc.sql("INSERT INTO refresh_session (token_hash, user_id, family_id, expires_at) VALUES (:hash, :user, :family, :expiry)")
            .param("hash", hash(token)).param("user", user.id()).param("family", family).param("expiry", expiry.atOffset(ZoneOffset.UTC)).update();
    }
    private String replacement(String token) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256"); mac.init(jwtKey);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(("pennyvoice-refresh:" + token).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException error) { throw new IllegalStateException(error); }
    }
    private Session accessSession(User user) {
        Instant now = Instant.now(), accessExpiry = now.plusSeconds(900);
        var claims = JwtClaimsSet.builder().issuer("pennyvoice").subject(user.id().toString()).audience(List.of("pennyvoice-api"))
            .issuedAt(now).expiresAt(accessExpiry).id(UUID.randomUUID().toString()).build();
        String jwt = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        return new Session(user, jwt, accessExpiry);
    }
    private void cookie(HttpServletResponse response, String value, Duration age) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from("pv_refresh", value).httpOnly(true).secure(secure).sameSite("Strict").path("/api/auth").maxAge(age).build().toString());
    }
    private String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }
}
