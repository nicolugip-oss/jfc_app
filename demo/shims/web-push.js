// Im Demo gibt es keinen Push-Dienst: Benachrichtigungen werden direkt auf diesem Gerät angezeigt
export const generateVAPIDKeys = () => ({ publicKey: 'demo', privateKey: 'demo' });
export const setVapidDetails = () => {};
export async function sendNotification(subscription, payload) {
  if (subscription.endpoint !== 'demo-local' || !('serviceWorker' in navigator)) return;
  if (globalThis.Notification?.permission !== 'granted') return;
  const data = JSON.parse(payload);
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(data.title, { body: data.body, icon: 'icon-192.png', badge: 'badge-96.png', tag: data.tag, data: { url: data.url } });
}
