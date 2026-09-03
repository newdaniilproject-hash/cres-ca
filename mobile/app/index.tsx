// Вход. Почта и пароль — единственный путь (CLAUDE.md: провайдеры
// выключены все, вход через Google удалён 18.08.2026).
//
// Кода из письма здесь ПОКА НЕТ, и это названо, а не забыто: второй шаг
// у него отдельный (`app/m/code-input.tsx` в вебе), а поле кода на
// телефоне обязано ещё и принимать вставку из буфера — это своя работа.
// До неё вход в приложение работает для того, у кого уже есть пароль.

import { useState } from 'react'
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, Text, TextInput, View,
} from 'react-native'
import { Redirect } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { authErrorText } from '../../lib/auth-errors'
import { t } from '../lib/i18n'
import { useSession } from '../lib/session'
import { supabase } from '../lib/supabase'
import { RADIUS, TAP_MIN, TYPE, WEIGHT, usePalette } from '../lib/theme'

export default function LoginScreen() {
  const { c } = usePalette()
  const insets = useSafeAreaInsets()
  const { loading, session } = useSession()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
        <ActivityIndicator color={c.accent} />
      </View>
    )
  }

  // Вошедшего держать на форме входа незачем. Разбор прав — уже на складе:
  // обе оси доступа стоят на самой странице, а не в навигации (CLAUDE.md,
  // «Доступ: роли и модули»).
  if (session) return <Redirect href="/inventory" />

  const submit = async () => {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setBusy(false)
    // Сырое сообщение GoTrue человеку не показываем — тот же словарь,
    // что и в вебе (`lib/auth-errors.ts`), тот же разбор.
    if (err) setError(authErrorText(t, err.message))
  }

  const canSubmit = email.trim().length > 3 && password.length >= 8 && !busy

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: 20,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: c.text, fontSize: TYPE.h1, fontWeight: WEIGHT.head, marginBottom: 6 }}>
          CRES-CA
        </Text>
        <Text style={{ color: c.muted, fontSize: TYPE.lead, marginBottom: 24 }}>
          {t('auth.brand.tagline')}
        </Text>

        <View
          style={{
            backgroundColor: c.surface,
            borderRadius: RADIUS.card,
            borderWidth: 1,
            borderColor: c.border,
            padding: 16,
            gap: 12,
          }}
        >
          <Text style={{ color: c.text, fontSize: TYPE.big, fontWeight: WEIGHT.head }}>
            {t('auth.login.subtitle')}
          </Text>

          <Field
            label={t('mobile.login.email')}
            value={email}
            onChange={setEmail}
            keyboardType="email-address"
          />
          <Field
            label={t('auth.field.password')}
            value={password}
            onChange={setPassword}
            secure
          />

          {error ? (
            <Text style={{ color: c.danger, fontSize: TYPE.sub }}>{error}</Text>
          ) : null}

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={{
              minHeight: TAP_MIN,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: RADIUS.control,
              // Выключенная кнопка НЕЙТРАЛЬНА, а не полупрозрачна:
              // на насыщенном кобальте прозрачность даёт белый текст
              // на светло-синем (CLAUDE.md, «Внешний вид»).
              backgroundColor: canSubmit ? c.accent : c.surface2,
            }}
          >
            {busy ? (
              <ActivityIndicator color={canSubmit ? c.accentText : c.muted} />
            ) : (
              <Text
                style={{
                  color: canSubmit ? c.accentText : c.faint,
                  fontSize: TYPE.body,
                  fontWeight: WEIGHT.head,
                }}
              >
                {t('auth.login.submit')}
              </Text>
            )}
          </Pressable>

          <Text style={{ color: c.faint, fontSize: TYPE.small, textAlign: 'center' }}>
            {t('mobile.login.hint')}
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({
  label, value, onChange, secure, keyboardType,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  secure?: boolean
  keyboardType?: 'default' | 'email-address'
}) {
  const { c } = usePalette()
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.muted, fontSize: TYPE.sub }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={c.faint}
        style={{
          minHeight: TAP_MIN,
          borderRadius: RADIUS.control,
          borderWidth: 1,
          borderColor: c.border,
          backgroundColor: c.bg,
          color: c.text,
          paddingHorizontal: 12,
          // 16 — пол, а не вкус: поле мельче iOS зумит на фокусе
          // и обратно не отъезжает. Ограничение системы старше макета.
          fontSize: TYPE.body,
        }}
      />
    </View>
  )
}
