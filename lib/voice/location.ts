export type DeviceLocationState = {
  granted: boolean;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  city?: string;
  region?: string;
  country?: string;
};

export const GEO_WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 120_000,
  timeout: 12_000,
};

const MIN_MOVE_M = 400;
const MIN_PUBLISH_MS = 120_000;

export function formatDeviceLocationLine(location: DeviceLocationState | null | undefined) {
  if (
    !location?.granted ||
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number" ||
    !Number.isFinite(location.latitude) ||
    !Number.isFinite(location.longitude)
  ) {
    return "DEVICE LOCATION: Not granted. You do not know where the device is. Do not invent a city.";
  }
  const coords = `${location.latitude.toFixed(3)}, ${location.longitude.toFixed(3)}`;
  const place = [location.city, location.region, location.country].filter(Boolean).join(", ");
  if (place) {
    return `DEVICE LOCATION: Ian granted device location. Near ${place} (${coords}). Do not invent a more specific place.`;
  }
  return `DEVICE LOCATION: Ian granted device location. Coordinates ${coords}. City unknown — do not invent one.`;
}

export function metersBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const earthM = 6_371_000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthM * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function shouldPublishLocation(
  prev: DeviceLocationState | null,
  next: DeviceLocationState,
  lastPublishAt: number,
  now = Date.now(),
) {
  if (!prev?.granted) return true;
  if ((next.city || "") !== (prev.city || "") || (next.region || "") !== (prev.region || "")) {
    return true;
  }
  const prevLat = prev.latitude;
  const prevLng = prev.longitude;
  const nextLat = next.latitude;
  const nextLng = next.longitude;
  if (
    typeof prevLat === "number" &&
    typeof prevLng === "number" &&
    typeof nextLat === "number" &&
    typeof nextLng === "number" &&
    metersBetween(
      { latitude: prevLat, longitude: prevLng },
      { latitude: nextLat, longitude: nextLng },
    ) >= MIN_MOVE_M
  ) {
    return true;
  }
  return now - lastPublishAt >= MIN_PUBLISH_MS;
}

export async function placeFromCoords(latitude: number, longitude: number) {
  try {
    const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("localityLanguage", "en");
    const response = await fetch(url);
    if (!response.ok) return {};
    const body = (await response.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      countryName?: string;
    };
    const city = (body.city || body.locality || "").trim();
    const region = (body.principalSubdivision || "").trim();
    const country = (body.countryName || "").trim();
    return {
      city: city || undefined,
      region: region || undefined,
      country: country || undefined,
    };
  } catch {
    return {};
  }
}

export function locationFromPosition(
  coords: GeolocationCoordinates,
  place?: Pick<DeviceLocationState, "city" | "region" | "country">,
): DeviceLocationState {
  return {
    granted: true,
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracyM: Number.isFinite(coords.accuracy) ? coords.accuracy : undefined,
    city: place?.city,
    region: place?.region,
    country: place?.country,
  };
}

export async function readGeoPermission(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}
