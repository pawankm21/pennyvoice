package dev.pennyvoice;

import jakarta.validation.Valid;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/entries")
public class LedgerController {
    private final LedgerService ledger;
    public LedgerController(LedgerService ledger) { this.ledger = ledger; }
    @GetMapping public List<Entry> list(@AuthenticationPrincipal Jwt jwt) { return ledger.entries(UUID.fromString(jwt.getSubject())); }
    @PutMapping("/{id}") public Entry save(@PathVariable UUID id, @Valid @RequestBody Entry entry, @AuthenticationPrincipal Jwt jwt) { return ledger.save(UUID.fromString(jwt.getSubject()), id, entry); }
}
