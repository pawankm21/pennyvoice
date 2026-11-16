package dev.pennyvoice;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Order(-200)
public class ApiFilter extends OncePerRequestFilter {
    private record Window(long until, int count) {}
    private final Map<String, Window> attempts = new HashMap<>();
    private final int limit;
    public ApiFilter(@Value("${pennyvoice.auth-rate-limit:20}") int limit) { this.limit = limit; }
    private synchronized boolean allowed(String ip) {
        long now = System.currentTimeMillis();
        attempts.entrySet().removeIf(entry -> entry.getValue().until() < now);
        Window window = attempts.getOrDefault(ip, new Window(now + 60000, 0));
        if (attempts.size() >= 10000 && !attempts.containsKey(ip)) return false;
        attempts.put(ip, new Window(window.until(), window.count() + 1));
        return window.count() < limit;
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        String path = request.getServletPath();
        if (path.startsWith("/api/")) response.setHeader("Cache-Control", "no-store");
        // shortcut: per-process IP throttle; move to a shared limiter before scaling to multiple instances.
        if (request.getMethod().equals("POST") && (path.equals("/api/auth/login") || path.equals("/api/auth/register")) && !allowed(request.getRemoteAddr())) {
            response.setStatus(429); response.setHeader("Retry-After", "60"); response.setContentType("application/json");
            response.getWriter().write("{\"detail\":\"Too many attempts. Try again in a minute.\"}"); return;
        }
        chain.doFilter(request, response);
    }
}
