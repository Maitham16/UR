package dev.urnexus

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Project-scoped JSON-RPC client for UR's HTTP compatibility endpoint. */
@Service(Service.Level.PROJECT)
class UrAcpClient(private val project: Project) {
    private val baseUrl = "http://127.0.0.1:9100"
    private val http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
    private val ids = AtomicLong()
    private val promptInFlight = AtomicBoolean(false)
    private val sessionLock = Any()
    private val json = Json { ignoreUnknownKeys = true }
    @Volatile private var initialized = false
    @Volatile private var sessionId: String? = null

    fun health(): Boolean = try {
        val req = HttpRequest.newBuilder(URI.create("$baseUrl/healthz"))
            .timeout(Duration.ofSeconds(5)).GET().build()
        http.send(req, HttpResponse.BodyHandlers.ofString()).statusCode() == 200
    } catch (_: Exception) { false }

    fun sendPrompt(prompt: String): String {
        require(prompt.isNotBlank()) { "Prompt cannot be empty." }
        require(prompt.length <= 64_000 && !prompt.contains('\u0000')) {
            "Prompt must contain at most 64,000 characters and no NUL bytes."
        }
        check(promptInFlight.compareAndSet(false, true)) {
            "A UR prompt is already running for this project."
        }
        try {
            val active = ensureSession()
            val result = rpc(
                "session/prompt",
                buildJsonObject {
                    put("sessionId", JsonPrimitive(active))
                    put("prompt", JsonPrimitive(prompt))
                    put("mode", JsonPrimitive("sync"))
                },
                Duration.ofMinutes(121),
            ).jsonObject
            val task = result["task"]?.jsonObject ?: error("ACP response did not include a task.")
            val status = task["status"]?.jsonPrimitive?.content ?: "unknown"
            val output = task["result"]?.jsonObject?.get("stdout")?.jsonPrimitive?.content
            val failure = task["result"]?.jsonObject?.get("stderr")?.jsonPrimitive?.content
            return output?.takeIf { it.isNotBlank() }
                ?: failure?.takeIf { it.isNotBlank() }
                ?: "UR task $status (${task["id"]?.jsonPrimitive?.content ?: "unknown id"})"
        } finally {
            promptInFlight.set(false)
        }
    }

    fun cancelPrompt(): Boolean {
        val active = sessionId ?: return false
        val result = rpc("session/cancel", buildJsonObject {
            put("sessionId", JsonPrimitive(active))
        }).jsonObject
        return result["canceled"]?.jsonPrimitive?.content?.toBooleanStrictOrNull() ?: false
    }

    fun closeSession() {
        val active = sessionId ?: return
        try { rpc("session/close", buildJsonObject { put("sessionId", JsonPrimitive(active)) }) }
        finally {
            synchronized(sessionLock) {
                if (sessionId == active) sessionId = null
            }
        }
    }

    private fun ensureSession(): String = synchronized(sessionLock) {
        if (!initialized) {
            rpc("initialize")
            initialized = true
        }
        if (sessionId == null) {
            val params = project.basePath?.let { cwd ->
                buildJsonObject { put("cwd", JsonPrimitive(cwd)) }
            }
            sessionId = rpc("session/new", params).jsonObject["sessionId"]?.jsonPrimitive?.content
                ?: error("ACP session/new response did not include sessionId.")
        }
        sessionId!!
    }

    private fun rpc(
        method: String,
        params: JsonObject? = null,
        timeout: Duration = Duration.ofSeconds(30),
    ): JsonElement {
        val requestId = ids.incrementAndGet()
        val body = buildJsonObject {
            put("jsonrpc", JsonPrimitive("2.0"))
            put("id", JsonPrimitive(requestId))
            put("method", JsonPrimitive(method))
            if (params != null) put("params", params)
        }
        val request = HttpRequest.newBuilder(URI.create("$baseUrl/acp"))
            .timeout(timeout)
            .header("content-type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
            .build()
        val response = http.send(request, HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) {
            error("ACP HTTP ${response.statusCode()}: ${response.body().take(500)}")
        }
        val payload = json.parseToJsonElement(response.body()).jsonObject
        payload["error"]?.jsonObject?.let { rpcError ->
            error("ACP ${rpcError["code"]?.jsonPrimitive?.content}: ${rpcError["message"]?.jsonPrimitive?.content}")
        }
        return payload["result"] ?: error("ACP response did not include a result.")
    }
}
