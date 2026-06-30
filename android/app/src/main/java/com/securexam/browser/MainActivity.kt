package com.securexam.browser

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.AnimationUtils
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.PreferenceManager
import java.net.URI

class MainActivity : AppCompatActivity() {

    companion object {
        private const val DEFAULT_EXAM_URL = "https://www.prodigyreview.ph/"
    }

    // ── Header Views ──────────────────────────────────────────────────────────
    private lateinit var tabScrollView: HorizontalScrollView
    private lateinit var tabContainer: LinearLayout
    private lateinit var btnNewTab: ImageButton
    private lateinit var btnBack: ImageButton
    private lateinit var btnForward: ImageButton
    private lateinit var btnReload: ImageButton
    private lateinit var btnHome: ImageButton
    private lateinit var tvUrl: EditText
    private lateinit var iconLock: ImageView
    private lateinit var spinnerLoading: ProgressBar
    private lateinit var pageProgressBar: ProgressBar
    private lateinit var btnExitSession: Button

    // ── Content Views ─────────────────────────────────────────────────────────
    private lateinit var webViewContainer: FrameLayout
    private lateinit var blockedOverlay: View
    private lateinit var blockedReason: TextView
    private lateinit var btnBackToExam: Button
    private lateinit var toastContainer: LinearLayout

    // ── Exit Modal Views ──────────────────────────────────────────────────────
    private lateinit var exitModal: FrameLayout
    private lateinit var exitPasswordInput: EditText
    private lateinit var exitErrorMsg: TextView
    private lateinit var exitCancelBtn: Button
    private lateinit var exitSubmitBtn: Button

    // ── State ─────────────────────────────────────────────────────────────────
    private lateinit var prefs: SharedPreferences
    private val tabs = mutableListOf<Tab>()
    private var activeTabIndex = 0
    private var nextTabId = 0
    private var isLockoutActive = false
    private var lastTouchTime = 0L
    private val mainHandler = Handler(Looper.getMainLooper())

    private val currentWebView: WebView get() = tabs[activeTabIndex].webView

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        hideSystemUI()
        setContentView(R.layout.activity_main)

        prefs = PreferenceManager.getDefaultSharedPreferences(this)
        bindViews()
        setupToolbarButtons()
        setupExitModal()
        setupOverlayButtons()
        startKioskMode()
        addNewTab()
    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
        if (isLockoutActive) {
            showBlockedOverlay("EXAM LOCKED: Focus lost or app switched.\nAdmin passcode required to resume.")
            btnBackToExam.text = "Unlock Exam"
        }
    }

    override fun onStop() {
        super.onStop()
        val url = if (tabs.isNotEmpty()) currentWebView.url else null
        if (url != null && !url.contains("about:blank") && !isLockoutActive) {
            isLockoutActive = true
        }
    }

    // ── View binding ──────────────────────────────────────────────────────────

    private fun bindViews() {
        tabScrollView    = findViewById(R.id.tabScrollView)
        tabContainer     = findViewById(R.id.tabContainer)
        btnNewTab        = findViewById(R.id.btnNewTab)
        btnBack          = findViewById(R.id.btnBack)
        btnForward       = findViewById(R.id.btnForward)
        btnReload        = findViewById(R.id.btnReload)
        btnHome          = findViewById(R.id.btnHome)
        tvUrl            = findViewById(R.id.tvUrl)
        iconLock         = findViewById(R.id.iconLock)
        spinnerLoading   = findViewById(R.id.spinnerLoading)
        pageProgressBar  = findViewById(R.id.pageProgressBar)
        btnExitSession   = findViewById(R.id.btnExitSession)
        webViewContainer = findViewById(R.id.webViewContainer)
        blockedOverlay   = findViewById(R.id.blockedOverlay)
        blockedReason    = findViewById(R.id.blockedReason)
        btnBackToExam    = findViewById(R.id.btnBackToExam)
        toastContainer   = findViewById(R.id.toastContainer)
        exitModal        = findViewById(R.id.exitModal)
        exitPasswordInput = findViewById(R.id.exitPasswordInput)
        exitErrorMsg     = findViewById(R.id.exitErrorMsg)
        exitCancelBtn    = findViewById(R.id.exitCancelBtn)
        exitSubmitBtn    = findViewById(R.id.exitSubmitBtn)
    }

    // ── Toolbar buttons ───────────────────────────────────────────────────────

    private fun setupToolbarButtons() {
        btnBack.setOnClickListener    { if (currentWebView.canGoBack()) currentWebView.goBack() }
        btnForward.setOnClickListener { if (currentWebView.canGoForward()) currentWebView.goForward() }
        btnReload.setOnClickListener  { currentWebView.reload() }
        btnHome.setOnClickListener    { hideBlockedOverlay(); loadExamUrl() }
        btnNewTab.setOnClickListener  { addNewTab("https://www.google.com") }
        btnExitSession.setOnClickListener { showExitModal() }

        tvUrl.setOnEditorActionListener { _, actionId, event ->
            if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_GO ||
                actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH ||
                (event != null && event.keyCode == android.view.KeyEvent.KEYCODE_ENTER && event.action == android.view.KeyEvent.ACTION_DOWN)) {
                handleUrlInputSubmit()
                true
            } else {
                false
            }
        }
    }

    // ── Exit modal ────────────────────────────────────────────────────────────

    private fun setupExitModal() {
        exitCancelBtn.setOnClickListener { hideExitModal() }
        exitSubmitBtn.setOnClickListener { attemptExit() }
        exitPasswordInput.setOnEditorActionListener { _, _, _ ->
            attemptExit(); true
        }
    }

    private fun showExitModal() {
        exitPasswordInput.text?.clear()
        exitErrorMsg.visibility = View.GONE
        exitModal.visibility = View.VISIBLE
        exitPasswordInput.requestFocus()
    }

    private fun hideExitModal() {
        exitModal.visibility = View.GONE
    }

    private fun attemptExit() {
        val password = exitPasswordInput.text.toString()
        val exitPassword  = prefs.getString("exit_password",  "admin123") ?: "admin123"
        val adminPassword = prefs.getString("admin_password", "admin123") ?: "admin123"
        if (password == exitPassword || password == adminPassword) {
            exitErrorMsg.visibility = View.GONE
            stopKioskMode()
            finish()
        } else {
            exitPasswordInput.text?.clear()
            exitErrorMsg.visibility = View.VISIBLE
        }
    }

    // ── Overlay buttons ───────────────────────────────────────────────────────

    private fun setupOverlayButtons() {
        btnBackToExam.setOnClickListener {
            if (isLockoutActive) showLockoutUnlockDialog()
            else { hideBlockedOverlay(); loadExamUrl() }
        }
    }

    // ── Tab management ────────────────────────────────────────────────────────

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    private fun createConfiguredWebView(): WebView {
        val wv = WebView(this)
        val ws = wv.settings
        ws.javaScriptEnabled    = true
        ws.domStorageEnabled    = true
        ws.databaseEnabled      = true
        ws.useWideViewPort      = true
        ws.loadWithOverviewMode = true
        ws.setSupportZoom(true)
        ws.builtInZoomControls  = true
        ws.displayZoomControls  = false
        ws.setSupportMultipleWindows(true)
        ws.javaScriptCanOpenWindowsAutomatically = false

        wv.webViewClient = object : WebViewClient() {

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                return if (isUrlBlocked(url)) {
                    showBlockedToast(url)
                    true
                } else {
                    hideBlockedOverlay()
                    false
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                val idx = tabIndexOf(view)
                if (idx >= 0) tabs[idx].url = url ?: ""
                if (idx == activeTabIndex) {
                    updateUrlBar(url)
                    spinnerLoading.visibility = View.VISIBLE
                    pageProgressBar.visibility = View.VISIBLE
                    updateNavButtons()
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                val idx = tabIndexOf(view)
                if (idx >= 0) tabs[idx].url = url ?: ""
                if (idx == activeTabIndex) {
                    updateUrlBar(url)
                    spinnerLoading.visibility = View.GONE
                    pageProgressBar.visibility = View.GONE
                    updateNavButtons()
                }
                injectSecurity(view ?: return)
            }
        }

        wv.webChromeClient = object : WebChromeClient() {

            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (tabIndexOf(view) == activeTabIndex) {
                    pageProgressBar.progress = newProgress
                    pageProgressBar.visibility = if (newProgress == 100) View.GONE else View.VISIBLE
                }
            }

            override fun onReceivedTitle(view: WebView?, title: String?) {
                val idx = tabIndexOf(view)
                if (idx >= 0 && !title.isNullOrBlank()) {
                    tabs[idx].title = title
                    refreshTabStrip()
                }
            }

            override fun onCreateWindow(
                view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message?
            ): Boolean {
                if (!isUserGesture || resultMsg == null) return false
                val newWv = createConfiguredWebView()
                val newTab = Tab(id = nextTabId++, webView = newWv)
                newWv.visibility = View.GONE
                webViewContainer.addView(newWv, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                ))
                tabs.add(newTab)
                (resultMsg.obj as WebView.WebViewTransport).webView = newWv
                resultMsg.sendToTarget()
                switchToTab(tabs.size - 1)
                return true
            }
        }

        // 2-finger double-tap → admin
        wv.setOnTouchListener { _, event ->
            if (event.pointerCount == 2 && event.actionMasked == MotionEvent.ACTION_POINTER_DOWN) {
                val now = System.currentTimeMillis()
                if (now - lastTouchTime < 1000) showAdminVerifyDialog()
                lastTouchTime = now
            }
            false
        }

        webViewContainer.addView(wv, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ))
        wv.visibility = View.GONE
        return wv
    }

    private fun addNewTab(url: String = getExamUrl()) {
        tvUrl.clearFocus()
        val wv  = createConfiguredWebView()
        val tab = Tab(id = nextTabId++, webView = wv)
        tabs.add(tab)
        wv.loadUrl(url)
        switchToTab(tabs.size - 1)
    }

    private fun switchToTab(index: Int) {
        if (index < 0 || index >= tabs.size) return
        tvUrl.clearFocus()
        tabs.forEach { it.webView.visibility = View.GONE }
        activeTabIndex = index
        tabs[index].webView.visibility = View.VISIBLE
        updateUrlBar(tabs[index].webView.url)
        updateNavButtons()
        refreshTabStrip()
        tabScrollView.post {
            tabScrollView.smoothScrollTo(index * dpToPx(154), 0)
        }
    }

    private fun closeTab(index: Int) {
        if (tabs.size <= 1) return
        val tab = tabs[index]
        webViewContainer.removeView(tab.webView)
        tab.webView.destroy()
        tabs.removeAt(index)
        val newIndex = if (index >= tabs.size) tabs.size - 1 else index
        activeTabIndex = newIndex
        switchToTab(newIndex)
    }

    private fun refreshTabStrip() {
        tabContainer.removeAllViews()
        tabs.forEachIndexed { index, tab ->
            val tabView  = layoutInflater.inflate(R.layout.item_tab, tabContainer, false)
            val tabTitle = tabView.findViewById<TextView>(R.id.tabTitle)
            val btnClose = tabView.findViewById<ImageButton>(R.id.btnCloseTab)

            val title = when {
                tab.title.isNotEmpty() && tab.title != "New Tab" -> tab.title
                tab.url.isNotEmpty() -> try {
                    URI(tab.url).host?.removePrefix("www.") ?: "Loading…"
                } catch (e: Exception) { "Loading…" }
                else -> "New Tab"
            }
            tabTitle.text = title

            val isActive = index == activeTabIndex
            tabView.setBackgroundResource(
                if (isActive) R.drawable.tab_active_bg else R.drawable.tab_inactive_bg
            )
            tabTitle.setTextColor(
                if (isActive) Color.parseColor("#f8fafc") else Color.parseColor("#94a3b8")
            )

            btnClose.visibility = if (tabs.size > 1) View.VISIBLE else View.GONE
            tabView.setOnClickListener { if (index != activeTabIndex) switchToTab(index) }
            btnClose.setOnClickListener { closeTab(index) }

            tabContainer.addView(tabView)
        }
    }

    private fun tabIndexOf(view: WebView?): Int =
        tabs.indexOfFirst { it.webView === view }

    // ── URL / navigation ──────────────────────────────────────────────────────

    private fun getExamUrl(): String =
        prefs.getString("exam_url", DEFAULT_EXAM_URL) ?: DEFAULT_EXAM_URL

    private fun loadExamUrl() = currentWebView.loadUrl(getExamUrl())

    private fun updateNavButtons() {
        btnBack.alpha    = if (currentWebView.canGoBack())    1.0f else 0.3f
        btnForward.alpha = if (currentWebView.canGoForward()) 1.0f else 0.3f
    }

    private fun updateUrlBar(url: String?) {
        if (tvUrl.hasFocus()) return
        if (url.isNullOrEmpty() || url == "about:blank") {
            tvUrl.setText("Loading…")
            iconLock.visibility = View.GONE
            return
        }
        val isHttps = url.startsWith("https://")
        iconLock.visibility = if (isHttps) View.VISIBLE else View.GONE

        val display = try {
            val uri = URI(url)
            val host  = uri.host?.removePrefix("www.") ?: url
            val path  = uri.rawPath?.takeIf { it.isNotEmpty() && it != "/" } ?: ""
            val query = if (uri.rawQuery != null) "?${uri.rawQuery}" else ""
            "$host$path$query"
        } catch (e: Exception) { url }
        tvUrl.setText(display)

        if (isHttps) {
            val examHost = try { URI(getExamUrl()).host?.removePrefix("www.") ?: "" } catch (e: Exception) { "" }
            val curHost  = try { URI(url).host?.removePrefix("www.") ?: "" } catch (e: Exception) { "" }
            iconLock.setColorFilter(
                if (curHost == examHost) Color.parseColor("#10b981") else Color.parseColor("#4f8ef7")
            )
        }
    }

    private fun handleUrlInputSubmit() {
        val rawInput = tvUrl.text.toString().trim()
        if (rawInput.isEmpty()) return

        var url = rawInput
        if (!url.startsWith("http://", ignoreCase = true) && !url.startsWith("https://", ignoreCase = true)) {
            url = if (url.contains(".") && !url.contains(" ")) {
                "https://$url"
            } else {
                "https://www.google.com/search?q=" + java.net.URLEncoder.encode(url, "UTF-8")
            }
        }

        if (isUrlBlocked(url)) {
            showBlockedToast(url)
            updateUrlBar(currentWebView.url)
        } else {
            hideBlockedOverlay()
            currentWebView.loadUrl(url)
        }

        tvUrl.clearFocus()
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as? android.view.inputmethod.InputMethodManager
        imm?.hideSoftInputFromWindow(tvUrl.windowToken, 0)
    }

    // ── AI block list ─────────────────────────────────────────────────────────

    private val builtInBlockedDomains = listOf(
        "openai.com", "chatgpt.com",
        "gemini.google.com", "bard.google.com", "aistudio.google.com", "makersuite.google.com",
        "copilot.microsoft.com", "copilot.cloud.microsoft", "bing.com",
        "claude.ai", "anthropic.com",
        "perplexity.ai", "meta.ai", "you.com", "poe.com", "mistral.ai", "chat.mistral.ai",
        "huggingface.co", "deepseek.com", "grok.com", "x.ai", "cohere.com", "coral.cohere.com",
        "pi.ai", "inflection.ai", "character.ai", "beta.character.ai",
        "runwayml.com", "githubnext.com", "copilot.github.com"
    )

    private fun isUrlBlocked(url: String): Boolean {
        if (url.startsWith("about:blank") || url.startsWith("data:") || url.startsWith("file://")) return false
        val host = try { URI(url).host?.lowercase() } catch (e: Exception) { null } ?: return false
        val normalized = host.removePrefix("www.")
        val examHost = try { URI(getExamUrl()).host?.lowercase()?.removePrefix("www.") } catch (e: Exception) { "" }
        if (normalized == examHost) return false
        for (domain in builtInBlockedDomains) {
            val d = domain.removePrefix("www.")
            if (normalized == d || normalized.endsWith(".$d")) return true
        }
        val blacklist = prefs.getString("url_blacklist", "") ?: ""
        val extra = blacklist.split(",").map { it.trim().lowercase().removePrefix("www.") }
        for (domain in extra) {
            if (domain.isNotEmpty() && (normalized == domain || normalized.endsWith(".$domain"))) return true
        }
        return false
    }

    // ── Security injection ────────────────────────────────────────────────────

    private fun injectSecurity(wv: WebView) {
        val js = """
            (function() {
                document.addEventListener('copy',        function(e) { e.preventDefault(); }, true);
                document.addEventListener('cut',         function(e) { e.preventDefault(); }, true);
                document.addEventListener('paste',       function(e) { e.preventDefault(); }, true);
                document.addEventListener('contextmenu', function(e) { e.preventDefault(); }, true);
                document.addEventListener('selectstart', function(e) { e.preventDefault(); }, true);
                document.body.style.userSelect = 'none';
                document.body.style.webkitUserSelect = 'none';
            })();
        """.trimIndent()
        wv.evaluateJavascript(js, null)
    }

    // ── Toast notifications (matching PC slide-in style) ──────────────────────

    private fun showBlockedToast(url: String) {
        val host = try { URI(url).host?.removePrefix("www.") ?: url } catch (e: Exception) { url }
        showToast(
            "🛡️ AI Blocking Shield",
            "You cannot access AI tools during the exam. The website \"$host\" is blocked by SecureExam."
        )
    }

    private fun showToast(title: String, message: String) {
        val toast = layoutInflater.inflate(R.layout.item_toast, toastContainer, false)
        val tvTitle   = toast.findViewById<TextView>(R.id.toastTitle)
        val tvBody    = toast.findViewById<TextView>(R.id.toastBody)
        val btnClose  = toast.findViewById<ImageButton>(R.id.toastClose)

        tvTitle.text = title
        tvBody.text  = message
        toast.alpha = 0f
        toast.translationX = dpToPx(200).toFloat()
        toastContainer.addView(toast)

        // Slide in
        toast.animate()
            .alpha(1f)
            .translationX(0f)
            .setDuration(350)
            .start()

        val dismiss = {
            toast.animate()
                .alpha(0f)
                .translationX(dpToPx(200).toFloat())
                .setDuration(300)
                .withEndAction { toastContainer.removeView(toast) }
                .start()
        }

        btnClose.setOnClickListener { dismiss() }
        mainHandler.postDelayed(dismiss, 6000)
    }

    // ── Blocked overlay ───────────────────────────────────────────────────────

    private fun showBlockedOverlay(reason: String) {
        blockedReason.text = reason
        blockedOverlay.visibility = View.VISIBLE
    }

    private fun hideBlockedOverlay() {
        blockedOverlay.visibility = View.GONE
    }

    // ── Kiosk mode ────────────────────────────────────────────────────────────

    private fun startKioskMode() {
        try {
            val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                if (am.lockTaskModeState == ActivityManager.LOCK_TASK_MODE_NONE) {
                    startLockTask()
                    Toast.makeText(this, R.string.kiosk_enabled, Toast.LENGTH_SHORT).show()
                }
            } else startLockTask()
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

    // ── System UI ─────────────────────────────────────────────────────────────

    private fun hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(android.view.WindowInsets.Type.statusBars() or android.view.WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
        }
    }

    // ── Back button ───────────────────────────────────────────────────────────

    override fun onBackPressed() {
        when {
            exitModal.visibility == View.VISIBLE -> hideExitModal()
            currentWebView.canGoBack() -> currentWebView.goBack()
            else -> showExitModal()
        }
    }

    // ── Admin dialogs ─────────────────────────────────────────────────────────

    private fun showAdminVerifyDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_admin_login, null)
        val etPassword = view.findViewById<EditText>(R.id.etPassword)
        android.app.AlertDialog.Builder(this)
            .setView(view)
            .setPositiveButton("Verify") { dialog, _ ->
                val password = etPassword.text.toString()
                val adminPassword = prefs.getString("admin_password", "admin123") ?: "admin123"
                if (password == adminPassword) showAdminMenu()
                else Toast.makeText(this, R.string.invalid_password, Toast.LENGTH_SHORT).show()
                dialog.dismiss()
            }
            .setNegativeButton("Cancel") { dialog, _ -> dialog.dismiss() }
            .show()
    }

    private fun showAdminMenu() {
        android.app.AlertDialog.Builder(this)
            .setTitle("SecureExam Admin Menu")
            .setItems(arrayOf("Configure Settings", "Unlock/Exit Kiosk")) { dialog, which ->
                when (which) {
                    0 -> startActivity(Intent(this, SettingsActivity::class.java))
                    1 -> { stopKioskMode(); finish() }
                }
                dialog.dismiss()
            }
            .show()
    }

    private fun showLockoutUnlockDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_admin_login, null)
        val etPassword = view.findViewById<EditText>(R.id.etPassword)
        view.findViewById<TextView>(R.id.dialogTitle).text = "Unlock Exam Session"
        view.findViewById<TextView>(R.id.dialogMessage).text = "Enter the exit/admin password to resume."
        android.app.AlertDialog.Builder(this)
            .setView(view)
            .setCancelable(false)
            .setPositiveButton("Unlock") { dialog, _ ->
                val pw   = etPassword.text.toString()
                val admin = prefs.getString("admin_password", "admin123") ?: "admin123"
                val exit  = prefs.getString("exit_password",  "admin123") ?: "admin123"
                if (pw == admin || pw == exit) {
                    isLockoutActive = false
                    btnBackToExam.text = "Return to Exam"
                    hideBlockedOverlay()
                    startKioskMode()
                    loadExamUrl()
                } else Toast.makeText(this, R.string.invalid_password, Toast.LENGTH_SHORT).show()
                dialog.dismiss()
            }
            .setNegativeButton("Cancel") { dialog, _ -> dialog.dismiss() }
            .show()
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private fun dpToPx(dp: Int): Int = (dp * resources.displayMetrics.density).toInt()
}
