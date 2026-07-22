/* OBL — Ottawa Beer League service worker
   Handles incoming Web Push notifications (announcements/reminders) and
   focuses/opens the app when a notification is tapped. */

self.addEventListener('install', function(event){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event){
  let data = {};
  try{
    data = event.data ? event.data.json() : {};
  }catch(e){
    data = { title: 'OBL', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'OBL Announcement';
  const options = {
    body: data.body || '',
    icon: './icon.png',
    badge: './icon.png',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList){
      for(const client of clientList){
        if('focus' in client) return client.focus();
      }
      if(self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
