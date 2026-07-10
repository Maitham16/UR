package dev.urnexus

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import javax.swing.JTextArea
import com.intellij.openapi.application.ApplicationManager

class UrToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val client = project.getService(UrAcpClient::class.java)
        val text = JTextArea()
        text.isEditable = false
        text.text = "Checking UR ACP server..."
        val content = ContentFactory.getInstance().createContent(JBScrollPane(text), "", false)
        toolWindow.contentManager.addContent(content)
        ApplicationManager.getApplication().executeOnPooledThread {
            val status = if (client.health())
                "Connected to UR ACP server (127.0.0.1:9100)."
            else
                "UR ACP server not running.\nStart it with: ur acp serve --port 9100"
            ApplicationManager.getApplication().invokeLater { text.text = status }
        }
    }
}
