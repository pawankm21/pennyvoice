package dev.pennyvoice;

import java.net.*;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.*;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "pennyvoice.jwt-secret=dGVzdC1zZWNyZXQtZm9yLWp3dC1hdC1sZWFzdC10aGlydHktdHdvLWJ5dGVz", "pennyvoice.cookie-secure=false", "pennyvoice.auth-rate-limit=100"
})
class PennyVoiceApplicationTests {
    @Container static PostgreSQLContainer postgres = new PostgreSQLContainer("postgres:17-alpine");
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl); registry.add("spring.datasource.username", postgres::getUsername); registry.add("spring.datasource.password", postgres::getPassword);
    }
    @LocalServerPort int port;
    @Autowired JdbcClient jdbc;
    @Autowired JwtEncoder encoder;
    static String field(String json, String field) {
        var matcher = Pattern.compile("\"" + field + "\"\\s*:\\s*\"([^\"]+)\"").matcher(json);
        assertTrue(matcher.find(), "Missing response field: " + field); return matcher.group(1);
    }
    class Client {
        final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build();
        String token;
        HttpResponse<String> call(String method, String path, String body, String bearer, String csrf) throws Exception {
            var builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path));
            if (bearer != null) builder.header("Authorization", "Bearer " + bearer);
            if (csrf != null) builder.header("X-XSRF-TOKEN", csrf);
            if (body != null) builder.header("Content-Type", "application/json");
            return http.send(builder.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
        }
        HttpResponse<String> auth(String action, String body) throws Exception {
            var csrf = call("GET", "/api/auth/csrf", null, null, null);
            return call("POST", "/api/auth/" + action, body, null, field(csrf.body(), "token"));
        }
        HttpResponse<String> entries(String method, String path, String body) throws Exception { return call(method, "/api/entries" + path, body, token, null); }
        String credentials(String email, String password) { return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}"; }
        String register() throws Exception {
            String email = UUID.randomUUID() + "@example.com";
            var response = auth("register", credentials(email, "a-strong-password-123"));
            assertEquals(201, response.statusCode(), response.body()); token = field(response.body(), "accessToken"); return email;
        }
    }
    String entry(UUID id, String kind, long amount, String person) {
        return """
            {"id":"%s","kind":"%s","amountPaise":%d,"date":"2026-11-16","description":"Test entry","person":"%s"}
            """.formatted(id, kind, amount, person);
    }
    @Test void authCsrfPasswordsRefreshAndLogout() throws Exception {
        var client = new Client();
        assertEquals(403, client.call("POST", "/api/auth/register", client.credentials("test@example.com", "a-strong-password-123"), null, null).statusCode());
        assertEquals(401, client.entries("GET", "", null).statusCode());
        String email = client.register();
        assertTrue(client.cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals("pv_refresh")).findFirst().orElseThrow().isHttpOnly());
        assertTrue(jdbc.sql("SELECT password_hash FROM app_user WHERE email=:email").param("email", email).query(String.class).single().startsWith("$2a$12$"));
        assertEquals(401, client.auth("login", client.credentials(email, "wrong-password-123")).statusCode());
        assertEquals(409, client.auth("register", client.credentials(email.toUpperCase(Locale.ROOT), "a-strong-password-123")).statusCode());
        assertEquals(200, client.auth("login", client.credentials(email, "a-strong-password-123")).statusCode());
        var refreshed = client.auth("refresh", "{}");
        assertEquals(200, refreshed.statusCode(), refreshed.body());
        assertNotEquals(client.token, field(refreshed.body(), "accessToken"));
        var replay = new Client();
        var oldCookie = (HttpCookie) client.cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals("pv_refresh")).findFirst().orElseThrow().clone();
        String beforeRotation = oldCookie.getValue();
        assertEquals(200, client.auth("refresh", "{}").statusCode());
        replay.cookies.getCookieStore().add(URI.create("http://127.0.0.1:" + port), (HttpCookie) oldCookie.clone());
        var retry = replay.auth("refresh", "{}");
        assertEquals(200, retry.statusCode(), retry.body());
        String replacement = replay.cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals("pv_refresh")).findFirst().orElseThrow().getValue();
        String currentCookie = client.cookies.getCookieStore().getCookies().stream().filter(cookie -> cookie.getName().equals("pv_refresh")).findFirst().orElseThrow().getValue();
        assertEquals(currentCookie, replacement);
        jdbc.sql("UPDATE refresh_session SET rotated_at=CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE token_hash=:hash")
            .param("hash", HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(beforeRotation.getBytes(java.nio.charset.StandardCharsets.UTF_8)))).update();
        replay.cookies.getCookieStore().removeAll(); replay.cookies.getCookieStore().add(URI.create("http://127.0.0.1:" + port), (HttpCookie) oldCookie.clone());
        assertEquals(401, replay.auth("refresh", "{}").statusCode(), "Replays outside the retry window must fail");
        assertEquals(204, client.auth("logout", "{}").statusCode());
        assertEquals(401, client.auth("refresh", "{}").statusCode());
        assertEquals(400, new Client().auth("register", client.credentials("short@example.com", "short")).statusCode());
    }
    @Test void logoutRevokesConcurrentRotationFamily() throws Exception {
        var original = new Client(); original.register();
        var refresh = new Client(); var logout = new Client();
        for (HttpCookie cookie : original.cookies.getCookieStore().getCookies()) {
            refresh.cookies.getCookieStore().add(URI.create("http://127.0.0.1:" + port), (HttpCookie) cookie.clone());
            logout.cookies.getCookieStore().add(URI.create("http://127.0.0.1:" + port), (HttpCookie) cookie.clone());
        }
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var rotation = executor.submit(() -> refresh.auth("refresh", "{}").statusCode());
            var revocation = executor.submit(() -> logout.auth("logout", "{}").statusCode());
            assertTrue(List.of(200, 401).contains(rotation.get()));
            assertEquals(204, revocation.get());
        }
        assertEquals(401, refresh.auth("refresh", "{}").statusCode());
    }
    @Test void validatesJwtAndIsolatesAccountsAndLegacyRows() throws Exception {
        var a = new Client(); var b = new Client(); a.register(); b.register();
        UUID id = UUID.randomUUID(); String body = entry(id, "expense", 15000, "");
        assertEquals(200, a.entries("PUT", "/" + id, body).statusCode());
        assertEquals(200, a.entries("PUT", "/" + id, body).statusCode());
        assertEquals(409, a.entries("PUT", "/" + id, entry(id, "expense", 16000, "")).statusCode());
        assertEquals("[]", b.entries("GET", "", null).body());
        assertEquals(200, b.entries("PUT", "/" + id, entry(id, "expense", 27000, "")).statusCode());
        assertFalse(b.entries("GET", "", null).body().contains("15000"));
        assertEquals(1, a.entries("GET", "", null).body().split(id.toString(), -1).length - 1);
        assertEquals("no-store", a.entries("GET", "", null).headers().firstValue("cache-control").orElse(""));
        UUID legacy = UUID.randomUUID();
        jdbc.sql("INSERT INTO ledger_entry(id,kind,amount_paise,entry_date,description,person) VALUES(:id,'expense',12345,'2026-11-16','Legacy private','')").param("id", legacy).update();
        assertFalse(a.entries("GET", "", null).body().contains(legacy.toString()));
        assertFalse(b.entries("GET", "", null).body().contains(legacy.toString()));
        assertEquals(401, a.call("GET", "/api/entries", null, a.token + "tampered", null).statusCode());
        var claims = JwtClaimsSet.builder().issuer("pennyvoice").subject(UUID.randomUUID().toString()).audience(List.of("pennyvoice-api")).issuedAt(Instant.now().minusSeconds(1000)).expiresAt(Instant.now().minusSeconds(300)).build();
        var expired = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        assertEquals(401, a.call("GET", "/api/entries", null, expired, null).statusCode());
        UUID invalid = UUID.randomUUID();
        assertEquals(400, a.entries("PUT", "/" + invalid, entry(invalid, "expense", -1, "")).statusCode());
        assertEquals(400, a.entries("PUT", "/" + invalid, entry(invalid, "expense", 100, "").replace("100,", "100.5,")).statusCode());
        assertEquals(400, a.entries("PUT", "/" + invalid, entry(invalid, "expense", 100, "").replace("2026-11-16", "2026-02-30")).statusCode());
    }
    @Test void concurrentRepaymentsStayWithinOwnerBalance() throws Exception {
        var client = new Client(); client.register(); var other = new Client(); other.register();
        UUID lent = UUID.randomUUID(); String person = "Rahul";
        assertEquals(200, client.entries("PUT", "/" + lent, entry(lent, "lent", 80000, person)).statusCode());
        UUID foreign = UUID.randomUUID();
        assertEquals(409, other.entries("PUT", "/" + foreign, entry(foreign, "repayment-received", 100, person)).statusCode());
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Callable<Integer> repay = () -> { UUID id = UUID.randomUUID(); return client.entries("PUT", "/" + id, entry(id, "repayment-received", 60000, person)).statusCode(); };
            var results = executor.invokeAll(List.of(repay, repay));
            var codes = List.of(results.get(0).get(), results.get(1).get()); assertTrue(codes.contains(200) && codes.contains(409), codes.toString());
        }
    }
}
