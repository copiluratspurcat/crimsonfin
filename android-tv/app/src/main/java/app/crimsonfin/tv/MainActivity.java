package app.crimsonfin.tv;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.Objects;

public final class MainActivity extends Activity {
    private final Uri gateway = Uri.parse(BuildConfig.GATEWAY_URL);
    private WebView web;
    private AlertDialog connectionError;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(11, 16, 25));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMediaPlaybackRequiresUserGesture(false);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString() + " CrimsonFinTV/0.1.0");
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !sameGateway(request.getUrl());
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showConnectionError();
            }

            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showConnectionError();
            }
        });
        setContentView(web);
        web.requestFocus();
        web.loadUrl(BuildConfig.GATEWAY_URL);
    }

    private boolean sameGateway(Uri url) {
        return "https".equalsIgnoreCase(url.getScheme()) && url.getUserInfo() == null
            && Objects.equals(gateway.getHost(), url.getHost()) && gateway.getPort() == url.getPort();
    }

    private void showConnectionError() {
        if (isFinishing() || (connectionError != null && connectionError.isShowing())) return;
        connectionError = new AlertDialog.Builder(this)
            .setTitle("CrimsonFin could not connect")
            .setMessage("Check your internet connection or try again when the gateway is available.")
            .setPositiveButton("Try again", (dialog, button) -> web.loadUrl(BuildConfig.GATEWAY_URL))
            .setNegativeButton("Close", (dialog, button) -> finish())
            .show();
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("!document.activeElement.dispatchEvent(new KeyboardEvent('keydown',"
            + "{key:'Escape',bubbles:true,cancelable:true}))", handled -> {
            if ("true".equals(handled) || isFinishing()) return;
            new AlertDialog.Builder(this).setTitle("Close CrimsonFin?")
                .setNegativeButton("Keep browsing", null).setPositiveButton("Close", (d, w) -> finish()).show();
        });
    }

    @Override protected void onPause() {
        web.evaluateJavascript("document.querySelector('video')?.pause()", null);
        CookieManager.getInstance().flush();
        web.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override protected void onDestroy() {
        setContentView(new View(this));
        web.destroy();
        super.onDestroy();
    }
}
