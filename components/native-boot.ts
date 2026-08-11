// Метка «мы внутри приложения» и перевод на родной экран — ДО первой
// отрисовки. Оба действия обязаны быть здесь, а не в useEffect.
//
// Почему не через useEffect и не через isNative() в компоненте: реакт
// узнаёт про нативность только после гидратации. Метку он поставит
// с опозданием на кадр — и человек увидит боковое меню, переключатель
// темы и «На головну». Редирект он сделает с опозданием на кадр — и
// человек на секунду увидит вебовую форму «Акаунт для бізнесу».
// Оба раза это уже ловилось на живом телефоне.
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
// Запасной путь намеренно узкий, иначе он сломает переходы из инстаграма
// на витрину продавца. Три условия сразу:
//   • путь принадлежит кабинету или входу (каталог, витрина /t/<slug>,
//     поиск и карта под ЗАПАСНОЕ правило не попадают: там наше приложение
//     и чужой встроенный браузер снаружи неразличимы. В пересобранном
//     приложении мост есть, и каталог опознаётся как приложение честно);
//   • строка браузера выглядит как голое веб-вью (Android «; wv» либо
//     iOS без Safari/);
//   • и это не чужой встроенный браузер — Instagram, Facebook, TikTok
//     и прочие отсекаются по имени.
//
// Каталог и витрина внутри приложения — это ПРИЛОЖЕНИЕ, а не сайт.
// Две площадки с одним содержимым, как у Rozetka. Поэтому отсюда
// переводятся только вход и регистрация: у них разный поток, а не
// разное оформление. Всё остальное остаётся на месте и просто получает
// родную оболочку через data-native.
export const nativeBootScript = `(function(){try{
var w=window,d=document,c=w.Capacitor,hard=false;
if(c&&c.isNativePlatform&&c.isNativePlatform())hard=true;
if(w.AndroidBiometric||w.AndroidOneSignal)hard=true;
var n=hard,p=location.pathname;
if(!n){try{if(localStorage.getItem('cres:native')==='1')n=true}catch(e){}}
if(!n){
  var mine=p==='/app'||p.indexOf('/app/')===0||p==='/m'||p.indexOf('/m/')===0
        ||p.indexOf('/register')===0||p==='/login';
  var ua=navigator.userAgent;
  var foreign=/Instagram|FBAN|FBAV|FB_IAB|Messenger|Line\\/|MicroMessenger|Twitter|TikTok|Snapchat|Pinterest|VKAndroidApp|OKApp|GSA\\//i.test(ua);
  var ios=/iPhone|iPad|iPod/.test(ua);
  var bare=/; wv\\)/.test(ua)||(ios&&!/Safari\\//.test(ua)&&!/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua));
  if(mine&&bare&&!foreign)n=true;
}
if(!n)return;
d.documentElement.setAttribute('data-native','1');
// Запоминаем только твёрдое опознание. Догадка по строке браузера
// в память не попадает: ошибись один раз — и обычный браузер на этом
// телефоне навсегда останется без бокового меню.
if(hard){try{localStorage.setItem('cres:native','1')}catch(e){}}
var T=[['/register/seller','/m/shop'],['/register','/m/register'],['/login','/m/login'],['/account','/app']];
for(var i=0;i<T.length;i++){
  if(p===T[i][0]||p.indexOf(T[i][0]+'/')===0){location.replace(T[i][1]+location.search);return}
}
}catch(e){}})()`
