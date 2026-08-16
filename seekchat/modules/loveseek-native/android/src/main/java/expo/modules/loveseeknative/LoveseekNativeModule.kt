package expo.modules.loveseeknative

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.location.Geocoder
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import java.util.Calendar
import java.util.Locale
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LoveseekNativeModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private var ticking = false

  // Handler messages are delivered while the process lives — unlike JS timers,
  // which Android may throttle in the background. The keep-alive service holds
  // the process; this loop wakes the JS side ("onTick") to do its checks.
  private val tickRunnable = object : Runnable {
    override fun run() {
      if (!ticking) return
      try {
        sendEvent("onTick", mapOf<String, Any>())
      } catch (_: Exception) {
        // React context not ready — skip this tick
      }
      handler.postDelayed(this, 45_000L)
    }
  }

  private val context: Context
    get() = requireNotNull(appContext.reactContext)

  // Launchers / system UI / keyboards aren't "an app the user is using".
  private fun isSystemish(pkg: String): Boolean {
    val p = pkg.lowercase()
    return listOf(
      "launcher", "home", "systemui", "inputmethod", "keyboard",
      "recents", "packageinstaller", "settings"
    ).any { p.contains(it) }
  }

  override fun definition() = ModuleDefinition {
    Name("LoveseekNative")
    Events("onTick")

    Function("startKeepAlive") { title: String, text: String ->
      val ctx = context
      val intent = Intent(ctx, KeepAliveService::class.java)
        .putExtra("title", title)
        .putExtra("text", text)
      try {
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(intent)
        else ctx.startService(intent)
        if (!ticking) {
          ticking = true
          handler.postDelayed(tickRunnable, 45_000L)
        }
        true
      } catch (_: Exception) {
        false // FGS-from-background restriction (Android 12+) or ROM refusal
      }
    }

    Function("stopKeepAlive") {
      ticking = false
      handler.removeCallbacks(tickRunnable)
      context.stopService(Intent(context, KeepAliveService::class.java))
    }

    Function("isKeepAliveRunning") { KeepAliveService.running }

    Function("hasUsageAccess") {
      val ctx = context
      val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      val mode = ops.checkOpNoThrow(
        AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName
      )
      mode == AppOpsManager.MODE_ALLOWED
    }

    Function("openUsageAccessSettings") {
      context.startActivity(
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
    }

    // The app most recently brought to the foreground within the last 2 min.
    // Returns null without usage access or when nothing surfaced.
    Function("getForegroundApp") {
      val ctx = context
      try {
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val end = System.currentTimeMillis()
        val events = usm.queryEvents(end - 120_000L, end)
        var pkg: String? = null
        val ev = UsageEvents.Event()
        while (events.hasNextEvent()) {
          events.getNextEvent(ev)
          // MOVE_TO_FOREGROUND == ACTIVITY_RESUMED (same constant on 29+)
          if (ev.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) pkg = ev.packageName
        }
        val found = pkg
        if (found == null) null
        else {
          val label = try {
            val pm = ctx.packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(found, 0)).toString()
          } catch (_: Exception) {
            found
          }
          mapOf(
            "packageName" to found,
            "label" to label,
            "self" to (found == ctx.packageName)
          )
        }
      } catch (_: Exception) {
        null
      }
    }

    // Distinct real apps the user brought to the foreground since `startMs`,
    // most-recent LAST. Powers catch-up-on-return (reliable, unlike background
    // ticks): when the user reopens LoveSeek we replay what they were doing.
    Function("getForegroundAppsSince") { startMs: Double ->
      val ctx = context
      val out = ArrayList<Map<String, Any>>()
      try {
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val events = usm.queryEvents(startMs.toLong(), System.currentTimeMillis())
        val ev = UsageEvents.Event()
        val seen = LinkedHashSet<String>()
        val order = ArrayList<String>()
        while (events.hasNextEvent()) {
          events.getNextEvent(ev)
          if (ev.eventType != UsageEvents.Event.MOVE_TO_FOREGROUND) continue
          val p = ev.packageName ?: continue
          if (p == ctx.packageName || isSystemish(p)) continue
          order.remove(p); order.add(p); seen.add(p) // keep last-seen order
        }
        val pm = ctx.packageManager
        for (p in order.takeLast(8)) {
          val label = try {
            pm.getApplicationLabel(pm.getApplicationInfo(p, 0)).toString()
          } catch (_: Exception) { p }
          out.add(mapOf("packageName" to p, "label" to label))
        }
      } catch (_: Exception) {}
      out
    }

    // Today's per-app foreground time (feature: screen-usage access). Returns
    // { totalMinutes, apps:[{label, minutes}] } sorted desc, system apps out.
    Function("getUsageToday") {
      val ctx = context
      try {
        val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val cal = Calendar.getInstance().apply {
          set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0)
          set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        val start = cal.timeInMillis
        val now = System.currentTimeMillis()
        val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, now)
        val byPkg = HashMap<String, Long>()
        for (u in stats) {
          if (u.totalTimeInForeground <= 0) continue
          val p = u.packageName ?: continue
          if (p == ctx.packageName || isSystemish(p)) continue
          byPkg[p] = (byPkg[p] ?: 0L) + u.totalTimeInForeground
        }
        val pm = ctx.packageManager
        val apps = byPkg.entries.sortedByDescending { it.value }.take(6).map { e ->
          val label = try {
            pm.getApplicationLabel(pm.getApplicationInfo(e.key, 0)).toString()
          } catch (_: Exception) { e.key }
          mapOf("label" to label, "minutes" to (e.value / 60000L).toInt())
        }
        val totalMin = (byPkg.values.sum() / 60000L).toInt()
        mapOf("totalMinutes" to totalMin, "apps" to apps)
      } catch (_: Exception) {
        null
      }
    }

    // Coarse location via the framework LocationManager (NO Google Play
    // Services — the target phone is de-Googled). Reads last-known from network
    // then gps (cheap, no active fix), best-effort reverse-geocode. Caller must
    // already hold the runtime permission (requested JS-side via PermissionsAndroid).
    Function("getLocation") {
      val ctx = context
      try {
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val providers = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
        var best: android.location.Location? = null
        for (p in providers) {
          val loc = try { lm.getLastKnownLocation(p) } catch (_: SecurityException) { null }
          if (loc != null && (best == null || loc.time > best!!.time)) best = loc
        }
        val b = best ?: return@Function null
        var city: String? = null
        try {
          val geo = Geocoder(ctx, Locale.getDefault())
          @Suppress("DEPRECATION")
          val addrs = geo.getFromLocation(b.latitude, b.longitude, 1)
          if (!addrs.isNullOrEmpty()) {
            val a = addrs[0]
            city = a.locality ?: a.subAdminArea ?: a.adminArea
          }
        } catch (_: Exception) {}
        mapOf(
          "lat" to b.latitude,
          "lng" to b.longitude,
          "city" to (city ?: ""),
          "ageMs" to (System.currentTimeMillis() - b.time).toDouble()
        )
      } catch (_: Exception) {
        null
      }
    }

    Function("isIgnoringBatteryOptimizations") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(context.packageName)
    }

    // Screen on and unlocked-ish? Usage events lag after screen-off, so the
    // watch loop needs this to avoid reacting to a phone lying in a pocket.
    Function("isInteractive") {
      val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isInteractive
    }

    Function("requestIgnoreBatteryOptimizations") {
      try {
        context.startActivity(
          Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + context.packageName)
          ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        true
      } catch (_: Exception) {
        try {
          context.startActivity(
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
          true
        } catch (_: Exception) {
          false
        }
      }
    }
  }
}
