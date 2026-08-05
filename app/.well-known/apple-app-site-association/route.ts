// Universal Links для iOS: ссылка на cres-ca.com, нажатая в инстаграме,
// почте или мессенджере, открывает приложение, а не браузер.
//
// Apple тянет этот файл сама, при установке приложения. Требования,
// на которых обычно всё и ломается:
//   • ровно этот путь, без расширения .json в адресе;
//   • Content-Type: application/json;
//   • отдаётся по HTTPS без единого редиректа;
//   • appID = TeamID.BundleID.
//
// ВАЖНО, чтобы это заработало: в App ID должна быть включена
// возможность Associated Domains, а в entitlements приложения —
// applinks:cres-ca.com. Пока возможность не включена в аккаунте
// Apple, файл просто лежит и никому не мешает; собирать с
// entitlement раньше времени нельзя — подпись упадёт.
export const dynamic = 'force-static'

const TEAM_ID = 'MBV78PNGVH'
const BUNDLE_ID = 'com.cresca.app'

export function GET() {
  const body = {
    applinks: {
      details: [
        {
          appIDs: [`${TEAM_ID}.${BUNDLE_ID}`],
          components: [
            // Возврат от провайдера входа приложение НЕ перехватывает:
            // код должен доехать схемой cresca://, иначе обмен
            // произойдёт не там, где лежит PKCE-верификатор.
            { '/': '/auth/*', exclude: true },
            { '/': '/api/*', exclude: true },
            { '/': '/*', comment: 'усе інше — у застосунку' },
          ],
        },
      ],
    },
    // Общий доступ к паролю сайта и приложения: менеджер паролей
    // предлагает тот же пароль, что человек уже сохранил на сайте.
    webcredentials: { apps: [`${TEAM_ID}.${BUNDLE_ID}`] },
  }

  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  })
}
