#!/usr/bin/env bash
# Патч нативного Android-проекта ПЕРЕД сборкой. Папка android/ пересоздаётся
# Capacitor'ом, поэтому правки вносим в пайплайне, а не в репозитории.
#
# Перенесено с DaKi (там обкатано на живых сборках) и адаптировано:
#   1. Разрешения CAMERA + POST_NOTIFICATIONS в манифест.
#   2. MainActivity: запрос разрешений при старте, нативный OneSignal
#      (на Android JS-мост в удалённый server.url не инжектится — веб-init
#      не сработает никогда), мосты JS→натив для пушей и биометрии,
#      кнопка «назад» = назад по истории WebView, а не выход из приложения.
#   3. androidx.biometric в зависимости — отпечаток/лицо для замка входа.
set -e

# App ID OneSignal публичный (не секрет). Берём из env Codemagic, чтобы
# не хардкодить до создания приложения в их панели.
OS_APP_ID="${ONESIGNAL_APP_ID:-ONESIGNAL_APP_ID_NOT_SET}"

MANIFEST="android/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST" ]; then
  # macOS BSD sed ломается на \n — perl ведёт себя одинаково везде (урок DaKi).
  for PERM in CAMERA POST_NOTIFICATIONS USE_BIOMETRIC VIBRATE; do
    if ! grep -q "android.permission.$PERM" "$MANIFEST"; then
      perl -0pi -e "s{<application}{<uses-permission android:name=\"android.permission.$PERM\" />\n    <application}" "$MANIFEST"
    fi
  done
  echo "OK: AndroidManifest — камера/уведомления/биометрия/вибрация"
else
  echo "ERROR: AndroidManifest.xml не найден"; exit 1
fi

# Зависимости: androidx.biometric для BiometricPrompt и нативный SDK
# OneSignal (в v5 он же тянет firebase-messaging).
#
# ГРАБЛИ: тут был s{...}{...} с фигурной скобкой ВНУТРИ замены
# («dependencies {»). perl считает вложенные скобки, замена не закрывалась,
# и он проглатывал имя файла как продолжение кода — билд падал с
# «Unknown regexp modifier "/t"». Разделитель / и никаких лишних скобок.
GRADLE="android/app/build.gradle"
if ! grep -q 'androidx.biometric' "$GRADLE"; then
  perl -0pi -e 's/dependencies \{/dependencies \{\n    implementation "androidx.biometric:biometric:1.1.0"\n    implementation "com.onesignal:OneSignal:[5.0.0, 5.99.99]"/' "$GRADLE"
  echo "OK: androidx.biometric + OneSignal SDK добавлены"
fi

MA=$(find android/app/src/main/java -name MainActivity.java | head -1)
if [ -z "$MA" ]; then echo "ERROR: MainActivity.java не найден"; exit 1; fi
PKG=$(grep -m1 '^package ' "$MA" | sed 's/package //; s/;//; s/[[:space:]]//g')

cat > "$MA" <<EOF
package ${PKG};

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.onesignal.OneSignal;
import com.onesignal.Continue;
import com.onesignal.notifications.INotificationClickEvent;
import com.onesignal.notifications.INotificationClickListener;
import com.onesignal.notifications.INotificationLifecycleListener;
import com.onesignal.notifications.INotificationWillDisplayEvent;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

public class MainActivity extends BridgeActivity {
  private static final String ONESIGNAL_APP_ID = "${OS_APP_ID}";

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Разрешения — сразу при старте, одним диалогом, без похода в настройки.
    List<String> perms = new ArrayList<>();
    perms.add(Manifest.permission.CAMERA);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      perms.add(Manifest.permission.POST_NOTIFICATIONS);
    }
    List<String> need = new ArrayList<>();
    for (String p : perms) {
      if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) need.add(p);
    }
    if (!need.isEmpty()) ActivityCompat.requestPermissions(this, need.toArray(new String[0]), 1001);

    // OneSignal нативно: JS-моста в удалённый server.url на Android нет.
    try {
      if (!ONESIGNAL_APP_ID.contains("NOT_SET")) {
        OneSignal.initWithContext(getApplicationContext(), ONESIGNAL_APP_ID);
        OneSignal.getNotifications().requestPermission(true, Continue.none());

        // Уведомление, пришедшее при ОТКРЫТОМ приложении, система
        // не показывает — и продавец, сидящий в складе, узнаёт
        // о заказе последним. Перехватываем и отдаём вебу: он рисует
        // полоску сверху, как в инстаграме и телеграме.
        OneSignal.getNotifications().addForegroundLifecycleListener(new INotificationLifecycleListener() {
          @Override
          public void onWillDisplay(INotificationWillDisplayEvent event) {
            try {
              String title = event.getNotification().getTitle();
              String body = event.getNotification().getBody();
              String url = null;
              JSONObject extra = event.getNotification().getAdditionalData();
              if (extra != null) url = extra.optString("url", null);
              // Системную шторку гасим: своя полоска уже показана,
              // две подряд — это уже шум.
              event.preventDefault();
              emitNotify(title, body, url);
            } catch (Throwable ignored) {}
          }
        });

        // Тап по уведомлению из шторки — переход туда, куда оно указывает.
        OneSignal.getNotifications().addClickListener(new INotificationClickListener() {
          @Override
          public void onClick(INotificationClickEvent event) {
            try {
              JSONObject extra = event.getNotification().getAdditionalData();
              final String url = extra == null ? null : extra.optString("url", null);
              if (url != null && !url.isEmpty()) {
                runOnUiThread(new Runnable() {
                  @Override public void run() {
                    try { getBridge().getWebView().loadUrl("https://cres-ca.com" + url); } catch (Throwable ignored) {}
                  }
                });
              }
            } catch (Throwable ignored) {}
          }
        });
      }
    } catch (Throwable ignored) { /* пуш не должен ронять приложение */ }

    // Мосты для веба.
    try {
      this.getBridge().getWebView().addJavascriptInterface(new OneSignalJsBridge(), "AndroidOneSignal");
      this.getBridge().getWebView().addJavascriptInterface(new BiometricJsBridge(), "AndroidBiometric");
      this.getBridge().getWebView().addJavascriptInterface(new HapticsJsBridge(), "AndroidHaptics");
    } catch (Throwable ignored) {}

    applyWebViewPermissionGrant();
  }

  @Override public void onStart()  { super.onStart();  applyWebViewPermissionGrant(); }
  @Override public void onResume() { super.onResume(); applyWebViewPermissionGrant(); }

  // «Назад» листает историю WebView, а не убивает приложение —
  // иначе первый же случайный свайп выбрасывает мастера со склада.
  @Override
  public void onBackPressed() {
    try {
      android.webkit.WebView wv = this.getBridge().getWebView();
      if (wv != null && wv.canGoBack()) { wv.goBack(); return; }
    } catch (Throwable ignored) {}
    super.onBackPressed();
  }

  // Камера в WebView: getUserMedia дергает onPermissionRequest —
  // грантим, приложение уже держит CAMERA (приём DaKi, там WebChromeClient
  // Capacitor перетирал грант, поэтому переустанавливаем в onStart/onResume).
  private void applyWebViewPermissionGrant() {
    try {
      final com.getcapacitor.Bridge bridge = this.getBridge();
      if (bridge == null) return;
      final android.webkit.WebView wv = bridge.getWebView();
      if (wv == null) return;
      wv.setWebChromeClient(new BridgeWebChromeClient(bridge) {
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
          runOnUiThread(new Runnable() {
            @Override public void run() {
              try { request.grant(request.getResources()); } catch (Throwable ignored) {}
            }
          });
        }
      });
    } catch (Throwable ignored) {}
  }

  // Полоска уведомления рисуется вебом: событие 'cres:notify'.
  private void emitNotify(final String title, final String body, final String url) {
    runOnUiThread(new Runnable() {
      @Override public void run() {
        try {
          JSONObject d = new JSONObject();
          d.put("title", title == null ? "Маркет" : title);
          if (body != null) d.put("body", body);
          if (url != null && !url.isEmpty()) d.put("href", url);
          getBridge().getWebView().evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('cres:notify',{detail:" + d.toString() + "}))", null);
        } catch (Throwable ignored) {}
      }
    });
  }

  // Отклик на касание. navigator.vibrate в WebView даёт грубое
  // «жужжание» — здесь короткие точные импульсы, как у системных
  // элементов. Длительность и сила подобраны так, чтобы отклик
  // чувствовался пальцем и не был слышен ухом.
  public class HapticsJsBridge {
    private Vibrator vib() {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          VibratorManager vm = (VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE);
          return vm == null ? null : vm.getDefaultVibrator();
        }
        return (Vibrator) getSystemService(VIBRATOR_SERVICE);
      } catch (Throwable e) { return null; }
    }

    private void buzz(long ms, int amplitude) {
      try {
        Vibrator v = vib();
        if (v == null || !v.hasVibrator()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          v.vibrate(VibrationEffect.createOneShot(ms, amplitude));
        } else {
          v.vibrate(ms);
        }
      } catch (Throwable ignored) {}
    }

    @JavascriptInterface
    public void impact(String style) {
      if ("heavy".equals(style))       buzz(18, 200);
      else if ("medium".equals(style)) buzz(12, 150);
      else                             buzz(8, 110);
    }

    @JavascriptInterface
    public void select() { buzz(5, 80); }

    // Итог действия читается ритмом, а не силой: успех — один щелчок,
    // предупреждение — два, ошибка — три коротких.
    @JavascriptInterface
    public void notify(String type) {
      try {
        Vibrator v = vib();
        if (v == null || !v.hasVibrator()) return;
        long[] pattern;
        if ("ERROR".equals(type))        pattern = new long[]{0, 12, 70, 12, 70, 12};
        else if ("WARNING".equals(type)) pattern = new long[]{0, 12, 90, 12};
        else                             pattern = new long[]{0, 14};
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          v.vibrate(VibrationEffect.createWaveform(pattern, -1));
        } else {
          v.vibrate(pattern, -1);
        }
      } catch (Throwable ignored) {}
    }
  }

  public static class OneSignalJsBridge {
    @JavascriptInterface
    public void setUser(String userId, String tag) {
      try {
        if (userId != null && !userId.isEmpty()) OneSignal.login(userId);
        if (tag != null && !tag.isEmpty()) OneSignal.getUser().addTag("tenant", tag);
      } catch (Throwable ignored) {}
    }
    @JavascriptInterface
    public void logout() {
      try { OneSignal.logout(); } catch (Throwable ignored) {}
    }
  }

  // Биометрия: веб зовёт window.AndroidBiometric.request(), результат
  // прилетает событием window 'cres:bio' с detail 'ok' | 'fail' | 'none'.
  public class BiometricJsBridge {
    @JavascriptInterface
    public boolean available() {
      try {
        return BiometricManager.from(MainActivity.this)
          .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
          == BiometricManager.BIOMETRIC_SUCCESS;
      } catch (Throwable e) { return false; }
    }

    @JavascriptInterface
    public void request() {
      runOnUiThread(new Runnable() {
        @Override public void run() {
          try {
            Executor executor = ContextCompat.getMainExecutor(MainActivity.this);
            BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) MainActivity.this, executor,
              new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult r) { emit("ok"); }
                @Override public void onAuthenticationError(int code, @NonNull CharSequence err) { emit("fail"); }
              });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
              .setTitle("Вхід у Маркет")
              .setSubtitle("Підтвердіть, що це ви")
              .setNegativeButtonText("Скасувати")
              .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK)
              .build();
            prompt.authenticate(info);
          } catch (Throwable e) { emit("none"); }
        }
      });
    }

    private void emit(final String result) {
      runOnUiThread(new Runnable() {
        @Override public void run() {
          try {
            getBridge().getWebView().evaluateJavascript(
              "window.dispatchEvent(new CustomEvent('cres:bio',{detail:'" + result + "'}))", null);
          } catch (Throwable ignored) {}
        }
      });
    }
  }
}
EOF
echo "OK: MainActivity — разрешения, OneSignal (+foreground), биометрия, вибрация, назад"
