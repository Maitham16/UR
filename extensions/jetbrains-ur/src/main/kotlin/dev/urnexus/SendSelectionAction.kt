package dev.urnexus

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.application.ApplicationManager

class SendSelectionAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val selection = editor.selectionModel.selectedText ?: return
        val project = e.project ?: return
        val client = project.getService(UrAcpClient::class.java)
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Sending selection to UR", true) {
            override fun run(indicator: ProgressIndicator) {
                val result = runCatching { client.sendPrompt(selection) }
                ApplicationManager.getApplication().invokeLater {
                    result.onSuccess { Messages.showInfoMessage(project, it.take(2000), "UR Agent") }
                        .onFailure { Messages.showErrorDialog(project, it.message ?: it.toString(), "UR Agent") }
                }
            }
        })
    }
}
