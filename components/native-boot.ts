// Метка «мы внутри приложения» ставится ДО первой отрисовки.
//
// Почему не через useEffect и не через isNative() в компоненте: реакт
// узнаёт про нативность только после гидратации, и первый кадр успевает
// показать веб-хром — боковое меню, переключатель темы, ссылку на сайт.
// Человек это видит и говорит «это же просто сайт в рамке». Именно на
// этом мы уже обожглись.
//
// Что проверяем и почему именно так:
//  1. window.Capacitor — на iOS мост вкладывается скриптом на documentStart,
//     то есть существует раньше любого нашего кода.
//  2. window.AndroidBiometric / AndroidOneSignal — на Android при удалённом
//     server.url моста НЕТ (грабли DaKi), но интерфейсы из MainActivity
//     через addJavascriptInterface доступны так же рано.
//  3. Флаг в localStorage — страховка после первого опознания.
//  4. Запасной путь по строке браузера. Он появился после того, как
//     установленный на телефон билд открыл ВЕБОВУЮ форму «Акаунт для
//     бізнесу»: бинарь собран со старым server.url и ведёт на /app,
//     а моста на Android нет — опознать приложение было нечем.
//     Пересборка это чинит, но чинить надо и уже установленное.
//
// Запасной путь намеренно узкий, иначе он сломает главное — переходы
// из инстаграма на витрину продавца. Три условия сразу:
//   • путь принадлежит кабинету или входу (витрина /t/<slug>, главная,
//     поиск и карта под правило не попадают НИКОГДА);
//   • строка браузера выглядит как голое веб-вью (Android «; wv» либо
//     iOS без Safari/);
//   • и это не чужой встроенный браузер — Instagram, Facebook, TikTok
//     и прочие отсекаются по имени.
export const nativeBootScript = `(function(){try{
var w=window,d=document,c=w.Capacitor,hard=false;
if(c&&c.isNativePlatform&&c.isNativePlatform())hard=true;
if(w.AndroidBiometric||w.AndroidOneSignal)hard=true;
var n=hard;
if(!n){try{if(localStorage.getItem('cres:native')==='1')n=true}catch(e){}}
if(!n){
  var p=location.pathname;
  var mine=p==='/app'||p.indexOf('/app/')===0||p==='/m'||p.indexOf('/m/')===0
        ||p.indexOf('/register')===0||p==='/login';
  var ua=navigator.userAgent;
  var foreign=/Instagram|FBAN|FBAV|FB_IAB|Messenger|Line\\/|MicroMessenger|Twitter|TikTok|Snapchat|Pinterest|VKAndroidApp|OKApp|GSA\\//i.test(ua);
  var ios=/iPhone|iPad|iPod/.test(ua);
  var bare=/; wv\\)/.test(ua)||(ios&&!/Safari\\//.test(ua)&&!/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua));
  if(mine&&bare&&!foreign)n=true;
}
if(n){
  d.documentElement.setAttribute('data-native','1');
  // Запоминаем только твёрдое опознание. Догадка по строке браузера
  // в память не попадает: ошибись один раз — и обычный браузер на этом
  // телефоне навсегда останется без бокового меню.
  if(hard){try{localStorage.setItem('cres:native','1')}catch(e){}}
}
}catch(e){}})()`
