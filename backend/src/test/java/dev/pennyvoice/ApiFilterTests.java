package dev.pennyvoice;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import static org.junit.jupiter.api.Assertions.*;

class ApiFilterTests {
    @Test void throttlesAuthenticationWithoutLoggingCredentials() throws Exception {
        var filter = new ApiFilter(2);
        for (int attempt = 0; attempt < 3; attempt++) {
            var request = new MockHttpServletRequest("POST", "/api/auth/login"); request.setServletPath("/api/auth/login"); request.setRemoteAddr("127.0.0.1");
            var response = new MockHttpServletResponse();
            filter.doFilter(request, response, (req, res) -> ((jakarta.servlet.http.HttpServletResponse) res).setStatus(204));
            assertEquals(attempt == 2 ? 429 : 204, response.getStatus());
            assertEquals("no-store", response.getHeader("Cache-Control"));
        }
    }
}
