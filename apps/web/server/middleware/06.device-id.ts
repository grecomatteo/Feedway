import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE_SECONDS,
  isDeviceId,
  newDeviceId,
} from '@app/infrastructure'

/**
 * A random id per browser, so a login from a new device can be told apart (Task 11).
 * It holds no personal data and is never logged.
 */
export default defineEventHandler((event) => {
  // never let a client-sent value through, on any route
  if (!event.path.startsWith('/api/auth/')) {
    overrideRequestHeader(event, 'x-app-device-id', null)
    return
  }
  let deviceId = getCookie(event, DEVICE_COOKIE)
  if (!isDeviceId(deviceId)) {
    deviceId = newDeviceId()
    setCookie(event, DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    })
  }
  overrideRequestHeader(event, 'x-app-device-id', deviceId)
})
