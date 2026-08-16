package expo.modules.loveseeknative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Foreground service whose ONLY job is to keep the app process alive (and
 * exempt from aggressive CN-ROM background kills) while:
 *  - a reply is streaming, or
 *  - the user enabled 后台守护 (persistent keep-alive).
 * It runs no work of its own — the JS side does everything.
 */
class KeepAliveService : Service() {
  companion object {
    @Volatile var running = false
    const val CHANNEL_ID = "loveseek-keepalive"
    const val NOTIF_ID = 8471
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra("title") ?: "LoveSeek"
    val text = intent?.getStringExtra("text") ?: "后台守护中"
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "后台守护", NotificationManager.IMPORTANCE_MIN)
      )
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pi = if (launch != null) PendingIntent.getActivity(
      this, 0, launch,
      PendingIntent.FLAG_UPDATE_CURRENT or
        (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
    ) else null
    val builder =
      if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL_ID)
      else @Suppress("DEPRECATION") Notification.Builder(this)
    val notification = builder
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .apply { if (pi != null) setContentIntent(pi) }
      .build()
    startForeground(NOTIF_ID, notification)
    running = true
    return START_STICKY
  }

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }
}
