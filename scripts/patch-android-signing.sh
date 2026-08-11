#!/usr/bin/env bash
# Подпись релизного .aab ключом из env Codemagic (группа android_signing).
# Вынесено из codemagic.yaml: heredoc внутри YAML ломается на отступах —
# ровно та мина, что задокументирована в DaKi. Здесь обычный bash.
set -e

if [ -z "$CM_KEYSTORE" ]; then
  echo "❌ CM_KEYSTORE не задан (base64 release.jks). Как создать — docs/STORE.md, п.5."
  exit 1
fi

echo "$CM_KEYSTORE" | base64 --decode > /tmp/release.jks

cat >> android/app/build.gradle <<'GRADLE'

android {
    signingConfigs {
        release {
            storeFile file("/tmp/release.jks")
            storePassword System.getenv("CM_KEYSTORE_PASSWORD")
            keyAlias System.getenv("CM_KEY_ALIAS")
            keyPassword System.getenv("CM_KEY_PASSWORD")
        }
    }
    buildTypes { release { signingConfig signingConfigs.release } }
}
GRADLE

echo "OK: release signing подключён"
