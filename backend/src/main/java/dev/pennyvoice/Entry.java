package dev.pennyvoice;

import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.UUID;

public record Entry(
    @NotNull UUID id,
    @NotNull @Pattern(regexp = "expense|lent|borrowed|repayment-received|repayment-paid") String kind,
    @Positive @Max(9007199254740991L) long amountPaise,
    @NotNull LocalDate date,
    @NotBlank @Size(max = 500) String description,
    @NotNull @Size(max = 100) String person
) {}
