// ⚠️ ВРЕМЕННЫЕ ДИАГНОСТИЧЕСКИЕ МАЯЧКИ. УДАЛИТЬ ПОСЛЕ РАЗБОРА.
//
// Заведены 12.08.2026 вместе с app/api/ping/[stage]/route.ts.
// Цель одна: узнать, до какой точки доходит запуск страницы внутри
// нативной обёртки, где она показывает «This page couldn't load».
// Это ИЗМЕРЕНИЕ, а не починка: поведение страницы они не меняют.
//
// Почему new Image().src, а не fetch и не sendBeacon:
//   • работает в самом раннем инлайн-скрипте <head>, когда ничего
//     ещё не инициализировано;
//   • ничего не требует от окружения (ни промисов, ни политики CORS);
//   • переживает уход страницы — запрос уже ушёл в сеть.
//
// Все вызовы обёрнуты в try/catch и в `?.`: маячок не имеет права
// уронить то, что измеряет.
//
// Параметр r=<число> одинаков на весь запуск приложения — по нему
// в логах Vercel отличается один запуск от другого. Личных данных
// не передаётся: только ступень, флаги и текст исключения.

/**
 * Ступень 1 — `head`. Ставится ПЕРВОЙ строкой в <head>, до
 * themeBootScript и до nativeBootScript.
 *
 * Здесь же вешаются ловушки исключений (`error`) и ухода страницы
 * (`hide`) — как можно раньше, чтобы поймать в том числе падение
 * самих загрузочных скриптов.
 *
 * addEventListener, а НЕ присваивание window.onerror: присваивание
 * затёрло бы чужой обработчик, если он появится, а правило задания —
 * не менять существующее поведение ни на строчку.
 */
export const pingHeadScript = `(function(){try{
var w=window,d=document;
w.__pingR=String(Math.floor(Math.random()*1e9));
w.__ping=function(stage,extra){try{
  var q='r='+w.__pingR+'&t='+Date.now();
  if(extra){for(var k in extra){q+='&'+k+'='+encodeURIComponent(String(extra[k]))}}
  var i=new Image();i.src='/api/ping/'+stage+'?'+q;
}catch(e){}};
w.__ping('head');
w.addEventListener('error',function(ev){try{
  var m=(ev&&(ev.message||(ev.error&&ev.error.message)))||'';
  w.__ping('error',{k:'err',m:String(m).slice(0,200),l:(ev&&ev.lineno)||0});
}catch(e){}},true);
w.addEventListener('unhandledrejection',function(ev){try{
  var r=ev&&ev.reason;
  w.__ping('error',{k:'rej',m:String((r&&r.message)||r||'').slice(0,200),l:0});
}catch(e){}});
w.addEventListener('pagehide',function(){try{w.__ping('hide')}catch(e){}});
}catch(e){}})()`

/**
 * Ступень 2 — `boot`. Ставится СРАЗУ ПОСЛЕ nativeBootScript.
 *
 * Два флага, ради которых всё и затевалось:
 *   cap    — существует ли window.Capacitor (то есть мы в веб-вью);
 *   native — проставился ли data-native на <html> (то есть отработал
 *            nativeBootScript и включился нативный слой).
 * Именно эта пара — единственное отличие обёртки от Safari, где
 * та же страница открывается.
 */
export const pingBootScript = `(function(){try{
var w=window,d=document;
if(!w.__ping)return;
w.__ping('boot',{
  cap:(w.Capacitor?1:0),
  native:(d.documentElement.hasAttribute('data-native')?1:0)
});
}catch(e){}})()`
