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
//  3. Флаг в localStorage — страховка на случай, если первое условие
//     не сработало: один раз опознали приложение и больше не гадаем.
//     Тот же ключ снимает NativeProvider, если платформа оказалась вебом.
export const nativeBootScript = `(function(){try{
var c=window.Capacitor,n=false;
if(c&&c.isNativePlatform&&c.isNativePlatform())n=true;
if(window.AndroidBiometric||window.AndroidOneSignal)n=true;
if(!n&&localStorage.getItem('cres:native')==='1')n=true;
if(n){document.documentElement.setAttribute('data-native','1');try{localStorage.setItem('cres:native','1')}catch(e){}}
}catch(e){}})()`
