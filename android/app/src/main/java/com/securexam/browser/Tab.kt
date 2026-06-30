package com.securexam.browser

import android.webkit.WebView

data class Tab(
    val id: Int,
    var title: String = "New Tab",
    var url: String = "",
    val webView: WebView
)
