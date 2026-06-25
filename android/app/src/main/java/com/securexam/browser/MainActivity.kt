package com.securexam.browser

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.PreferenceManager
import java.net.URI

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var blockedOverlay: View
    private lateinit var blockedReason: TextView
    private lateinit var btnBackToExam: Button
    private lateinit var prefs: SharedPreferences

    // Detect double-finger touch for admin dialog trigger
    private var lastTouchTime: Long = 0
    private val ADMIN_GESTURE_TIMEOUT = 3000L // 3 seconds holding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Block screen capture and screenshots
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        
        // Enable fullscreen immersive mode
        hideSystemUI()

        setContentView(R.layout.activity_main)

        prefs = PreferenceManager.getDefaultSharedPreferences(this)

        webView = findViewById(R.id.webView)
        blockedOverlay = findViewById(R.id.blockedOverlay)
        blockedReason = findViewById(R.id.blockedReason)
        btnBackToExam = findViewById(R.id.btnBackToExam)

        setupWebView()
        setupListeners()
        
        // Enter Lock Task (Kiosk Mode)
        startKioskMode()

        loadExamUrl()
    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
        // If settings were updated, reload the whitelisted checks
        if (webView.url == null) {
            loadExamUrl()
        }
    }

    private fun hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            val controller = window.insetsController
            if (controller != null) {
                controller.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val webSettings = webView.settings
        webSettings.javaScriptEnabled = true
        webSettings.domStorageEnabled = true
        webSettings.databaseEnabled = true
        webSettings.useWideViewPort = true
        webSettings.loadWithOverviewMode = true
        webSettings.setSupportZoom(false)
        webSettings.builtInZoomControls = false

        // Custom WebViewClient for lockdown rules
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                val host = url.host ?: return false
                
                if (isUrlWhitelisted(host)) {
                    hideBlockedOverlay()
                    return false // Let WebView load it
                } else {
                    showBlockedOverlay("Navigation to non-whitelisted domain: $host")
                    return true // Intercept/block
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectClipboardAndContextBlockers()
            }
        }
    }

    private fun setupListeners() {
        btnBackToExam.setOnClickListener {
            hideBlockedOverlay()
            loadExamUrl()
        }

        // Detect 2-finger double-tap to prompt admin menu
        webView.setOnTouchListener { _, event ->
            if (event.pointerCount == 2) {
                val action = event.actionMasked
                if (action == MotionEvent.ACTION_POINTER_DOWN) {
                    val now = System.currentTimeMillis()
                    if (now - lastTouchTime < 1000) {
                        showAdminVerifyDialog()
                    }
                    lastTouchTime = now
                }
            }
            false
        }
    }

    private fun loadExamUrl() {
        val url = prefs.getString("exam_url", "https://www.google.com") ?: "https://www.google.com"
        webView.loadUrl(url)
    }

    private fun isUrlWhitelisted(host: String): Boolean {
        val examUrl = prefs.getString("exam_url", "") ?: ""
        val examHost = try { URI(examUrl).host } catch (e: Exception) { "" }
        if (host.equals(examHost, ignoreCase = true)) return true

        val whitelist = prefs.getString("url_whitelist", "") ?: ""
        val domains = whitelist.split(",").map { it.trim().lowercase() }
        for (domain in domains) {
            if (domain.isNotEmpty() && (host.lowercase() == domain || host.lowercase().endsWith(".$domain"))) {
                return true
            }
        }
        return false
    }

    private fun injectClipboardAndContextBlockers() {
        // Javascript to disable copy, paste, text selection, and right click context menu
        val js = """
            (function() {
                document.addEventListener('copy', function(e) { e.preventDefault(); }, true);
                document.addEventListener('cut', function(e) { e.preventDefault(); }, true);
                document.addEventListener('paste', function(e) { e.preventDefault(); }, true);
                document.addEventListener('contextmenu', function(e) { e.preventDefault(); }, true);
                document.addEventListener('selectstart', function(e) { e.preventDefault(); }, true);
                document.body.style.userSelect = 'none';
                document.body.style.webkitUserSelect = 'none';
            })();
        """.trimIndent()
        webView.evaluateJavascript(js, null)
    }

    private fun showBlockedOverlay(reason: String) {
        blockedReason.text = reason
        blockedOverlay.visibility = View.VISIBLE
    }

    private fun hideBlockedOverlay() {
        blockedOverlay.visibility = View.GONE
    }

    private fun startKioskMode() {
        try {
            val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                // If the app is set up as Device Owner, it will pin task immediately.
                // Otherwise, it prompts the user to "Pin screen".
                if (activityManager.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
                    startLockTask()
                    Toast.makeText(this, R.string.kiosk_enabled, Toast.LENGTH_SHORT).show()
                }
            } else {
                startLockTask()
            }
        } catch (e: Exception) {
            Toast.makeText(this, "Failed to enter Lock Task: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun stopKioskMode() {
        try {
            stopLockTask()
            Toast.makeText(this, R.string.kiosk_disabled, Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Failed to exit Lock Task: ${e.message}", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onBackPressed() {
        // Do nothing to disable Back button
        // Or if we want to prompt for exit, we could trigger the dialog here:
        showExitVerifyDialog()
    }

    private fun showAdminVerifyDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_admin_login, null)
        val etPassword = view.findViewById<EditText>(R.id.etPassword)

        AlertDialog.Builder(this)
            .setView(view)
            .setPositiveButton("Verify") { dialog, _ ->
                val password = etPassword.text.toString()
                val adminPassword = prefs.getString("admin_password", "admin123") ?: "admin123"
                if (password == adminPassword) {
                    showAdminMenu()
                } else {
                    Toast.makeText(this, R.string.invalid_password, Toast.LENGTH_SHORT).show()
                }
                dialog.dismiss()
            }
            .setNegativeButton("Cancel") { dialog, _ -> dialog.dismiss() }
            .show()
    }

    private fun showExitVerifyDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_admin_login, null)
        val etPassword = view.findViewById<EditText>(R.id.etPassword)
        val dialogTitle = view.findViewById<TextView>(R.id.dialogTitle)
        val dialogMessage = view.findViewById<TextView>(R.id.dialogMessage)

        dialogTitle.setText(R.string.dialog_exit_title)
        dialogMessage.setText(R.string.dialog_exit_msg)

        AlertDialog.Builder(this)
            .setView(view)
            .setPositiveButton("Exit") { dialog, _ ->
                val password = etPassword.text.toString()
                val exitPassword = prefs.getString("exit_password", "admin123") ?: "admin123"
                if (password == exitPassword) {
                    stopKioskMode()
                    finish()
                } else {
                    Toast.makeText(this, R.string.invalid_password, Toast.LENGTH_SHORT).show()
                }
                dialog.dismiss()
            }
            .setNegativeButton("Cancel") { dialog, _ -> dialog.dismiss() }
            .show()
    }

    private fun showAdminMenu() {
        val options = arrayOf("Configure Settings", "Unlock/Exit Kiosk", "Cancel")
        AlertDialog.Builder(this)
            .setTitle("SecureExam Admin Menu")
            .setItems(options) { dialog, which ->
                when (which) {
                    0 -> {
                        // Open Settings
                        val intent = Intent(this, SettingsActivity::class.java)
                        startActivity(intent)
                    }
                    1 -> {
                        // Exit Kiosk and close app
                        stopKioskMode()
                        finish()
                    }
                }
                dialog.dismiss()
            }
            .show()
    }
}
