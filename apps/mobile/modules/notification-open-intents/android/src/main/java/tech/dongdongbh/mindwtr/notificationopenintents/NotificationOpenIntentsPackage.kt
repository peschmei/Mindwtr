package tech.dongdongbh.mindwtr.notificationopenintents

import android.app.Application
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

// Auto-discovered by expo-modules autolinking (any *Package.kt in a module's
// android source), so this needs no entry in expo-module.config.json.
class NotificationOpenIntentsPackage : Package {
  override fun createApplicationLifecycleListeners(context: android.content.Context): List<ApplicationLifecycleListener> {
    return listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        // Any process start (activity tap, alarm receiver, widget) re-pins the
        // capture notification that OEM process kills silently remove — those
        // removals fire no dismiss intent, and waiting for React to reach
        // foreground leaves the handle gone while the app is closed (#819).
        // Off the main thread and non-fatal: the handle is optional UX.
        Thread({
          try {
            PersistentCaptureNotifier.restoreOnProcessStart(application)
          } catch (_: Throwable) {
          }
        }, "mindwtr-capture-repin").start()
      }
    })
  }
}
