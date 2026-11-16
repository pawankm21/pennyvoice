package dev.pennyvoice;

import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import static org.springframework.http.HttpStatus.*;

@Service
public class LedgerService {
    private final JdbcClient jdbc;
    public LedgerService(JdbcClient jdbc) { this.jdbc = jdbc; }

    public List<Entry> entries(UUID owner) {
        return jdbc.sql("SELECT id, kind, amount_paise, entry_date AS date, description, person FROM ledger_entry WHERE owner_id = :owner ORDER BY sequence").param("owner", owner)
            .query(Entry.class).list();
    }

    @Transactional
    public Entry save(UUID owner, UUID id, Entry entry) {
        if (entry.date().getYear() < 1 || entry.date().getYear() > 9999) throw new ResponseStatusException(BAD_REQUEST, "Date is outside the supported range");
        if (!id.equals(entry.id())) throw new ResponseStatusException(BAD_REQUEST, "Entry IDs must match");
        // Serialize balance checks within this account.
        jdbc.sql("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))").param("owner", owner.toString()).query((rs, row) -> 0).list();
        // shortcut: scan this personal ledger; use SQL aggregates when history makes writes slow.
        var existing = entries(owner);
        var duplicate = existing.stream().filter(item -> item.id().equals(id)).findFirst();
        if (duplicate.isPresent()) {
            if (!duplicate.get().equals(entry)) throw new ResponseStatusException(CONFLICT, "This ID already has different content");
            return duplicate.get();
        }
        if (!entry.kind().equals("expense") && entry.person().isBlank())
            throw new ResponseStatusException(BAD_REQUEST, "A person is required");
        long total = entry.amountPaise();
        for (Entry item : existing) {
            if (total > 9007199254740991L - item.amountPaise()) throw new ResponseStatusException(BAD_REQUEST, "Ledger amount limit exceeded");
            total += item.amountPaise();
        }
        if (entry.kind().startsWith("repayment-")) {
            boolean received = entry.kind().equals("repayment-received");
            long outstanding = existing.stream().filter(item -> item.person().trim().equalsIgnoreCase(entry.person().trim()))
                .mapToLong(item -> item.kind().equals(received ? "lent" : "borrowed") ? item.amountPaise()
                    : item.kind().equals(entry.kind()) ? -item.amountPaise() : 0).sum();
            if (entry.amountPaise() > outstanding) throw new ResponseStatusException(CONFLICT, "Repayment exceeds the outstanding balance");
        }
        jdbc.sql("INSERT INTO ledger_entry (id, kind, amount_paise, entry_date, description, person, owner_id) VALUES (:id, :kind, :amount, :date, :description, :person, :owner)")
            .param("owner", owner).param("id", id).param("kind", entry.kind()).param("amount", entry.amountPaise()).param("date", entry.date())
            .param("description", entry.description()).param("person", entry.person()).update();
        return entry;
    }
}
