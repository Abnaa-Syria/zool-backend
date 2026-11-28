import { env } from '../../config/env';
import { runtimeSettings } from '../../shared/settings/runtime-settings';
import { publicAppRepository } from './public-app.repository';

const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));

/** No-login data every app needs at start-up (splash, pickers, home). */
/**
 * Raster tiles for flutter_map / Leaflet. With a MapTiler key: MapTiler «Streets» (local-language
 * labels, so Arabic in Sudan); otherwise the OpenStreetMap community server (fine for testing only).
 * `tileUrlRetina` is for high-density screens (phones).
 */
function mapTiles(key: string) {
  if (key) {
    const base = `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}`;
    const k = encodeURIComponent(key);
    return {
      provider: 'maptiler',
      tileUrl: `${base}.png?key=${k}`,
      tileUrlRetina: `${base}@2x.png?key=${k}`,
      attribution: '© MapTiler © OpenStreetMap contributors',
      maxZoom: 19,
    };
  }
  const osm = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  return { provider: 'osm', tileUrl: osm, tileUrlRetina: osm, attribution: '© OpenStreetMap contributors', maxZoom: 19 };
}

export class PublicAppService {
  appConfig() {
    const e = env();
    const support = (key: 'support.phone' | 'support.whatsapp' | 'support.email') => String(runtimeSettings.get(key)) || null;
    return {
      defaultCountryCode: '+249',
      currency: 'SDG',
      minorUnitsPerMajor: 100,
      timeZone: 'Africa/Khartoum',
      languages: ['ar', 'en'],
      defaultLanguage: 'ar',
      otp: { length: e.OTP_LENGTH, resendAfterSeconds: runtimeSettings.number('security.otpResendCooldownSeconds'), ttlSeconds: e.OTP_TTL_SECONDS },
      minVersions: {
        customer: String(runtimeSettings.get('app.customer.minVersion')),
        driver: String(runtimeSettings.get('app.driver.minVersion')),
        broker: String(runtimeSettings.get('app.broker.minVersion')),
      },
      support: { phone: support('support.phone'), whatsapp: support('support.whatsapp'), email: support('support.email') },
      features: {
        cashOnBoard: runtimeSettings.boolean('cash.enabled'),
        roundTrip: true,
        maintenanceMode: runtimeSettings.boolean('platform.maintenanceMode'),
      },
      /** Live tracking is polled (API_CONVENTIONS §12) */
      liveTrackingPollSeconds: 15,
      holdTtlSeconds: runtimeSettings.number('booking.seatHoldTtlSeconds'),
      maps: mapTiles(String(runtimeSettings.get('maps.maptilerKey') ?? '').trim()),
    };
  }

  async cities(q?: string) {
    const rows = await publicAppRepository.listCities(q?.trim() || undefined);
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      imageUrl: c.imageUrl,
      isPopular: c.isPopular,
      stations: c.stations.map((s) => ({
        id: s.id,
        nameAr: s.nameAr,
        nameEn: s.nameEn,
        address: s.address,
        latitude: num(s.latitude),
        longitude: num(s.longitude),
      })),
    }));
  }

  /** Popular destinations with the cheapest upcoming fare (null when nothing is on sale). */
  async popularDestinations() {
    const cities = await publicAppRepository.listPopularCities();
    const prices = await Promise.all(cities.map((c) => publicAppRepository.minUpcomingPriceInto(c.id)));
    return cities.map((c, i) => ({
      city: { id: c.id, code: c.code, nameAr: c.nameAr, nameEn: c.nameEn },
      imageUrl: c.imageUrl,
      fromPriceMinor: prices[i] ?? null,
    }));
  }
}

export const publicAppService = new PublicAppService();
