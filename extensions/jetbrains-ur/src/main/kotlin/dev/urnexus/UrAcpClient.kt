package dev.urnexus

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

/**
 * Minimal ACP client: UR runs the server (`ur acp serve --port 9100`); the
 * plugin stays a thin HTTP client so protocol evolution lives in the CLI.
 */
class UrAcpClient(private val baseUrl: String = "http://127.0.0.1:9100") {
    private val http = HttpClient.newHttpClient()

    fun health(): Boolean = try {
        val req = HttpRequest.newBuilder(URI.create("$baseUrl/healthz")).GET().build()
        http.send(req, HttpResponse.BodyHandlers.ofString()).statusCode() == 200
    } catch (_: Exception) { false }

    fun sendPrompt(prompt: String): String {
        val body = """{"prompt": ${jsonEscape(prompt)}}"""
        val req = HttpRequest.newBuilder(URI.create("$baseUrl/v1/prompt"))
            .header("content-type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build()
        return http.send(req, HttpResponse.BodyHandlers.ofString()).body()
    }

    private fun jsonEscape(s: String): String =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
}
