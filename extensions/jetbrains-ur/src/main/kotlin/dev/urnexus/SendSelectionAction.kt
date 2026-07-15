package dev.urnexus

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProcessCanceledException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.LockSupport

class SendSelectionAction : AnAction() {
    override fun update(e: AnActionEvent) {
        val selection = e.getData(CommonDataKeys.EDITOR)?.selectionModel?.selectedText
        e.presentation.isEnabledAndVisible = e.project != null && !selection.isNullOrBlank()
    }

    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val selection = editor.selectionModel.selectedText ?: return
        val project = e.project ?: return
        val client = project.getService(UrAcpClient::class.java)
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Sending selection to UR", true) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                val finished = AtomicBoolean(false)
                val cancellationMonitor = CompletableFuture.runAsync {
                    while (!finished.get()) {
                        if (
                            indicator.isCanceled &&
                            runCatching { client.cancelPrompt() }.getOrDefault(false)
                        ) return@runAsync
                        LockSupport.parkNanos(100_000_000)
                        if (Thread.currentThread().isInterrupted) return@runAsync
                    }
                }
                try {
                    indicator.checkCanceled()
                    val result = client.sendPrompt(selection)
                    indicator.checkCanceled()
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showInfoMessage(project, result.take(2000), "UR Agent")
                    }
                } catch (cancelled: ProcessCanceledException) {
                    runCatching { client.cancelPrompt() }
                    throw cancelled
                } catch (error: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        Messages.showErrorDialog(project, error.message ?: error.toString(), "UR Agent")
                    }
                } finally {
                    finished.set(true)
                    cancellationMonitor.cancel(true)
                }
            }
        }.setCancelText("Cancel UR prompt"))
    }
}
