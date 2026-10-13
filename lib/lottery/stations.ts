import { weekdayOf } from "./time.ts";

/** Canonical display names, keyed by slug. */
const STATION_NAMES: Record<string, string> = {
  "tp-hcm": "TP. HCM",
  "dong-thap": "Đồng Tháp",
  "ca-mau": "Cà Mau",
  "ben-tre": "Bến Tre",
  "vung-tau": "Vũng Tàu",
  "bac-lieu": "Bạc Liêu",
  "dong-nai": "Đồng Nai",
  "can-tho": "Cần Thơ",
  "soc-trang": "Sóc Trăng",
  "tay-ninh": "Tây Ninh",
  "an-giang": "An Giang",
  "binh-thuan": "Bình Thuận",
  "vinh-long": "Vĩnh Long",
  "binh-duong": "Bình Dương",
  "tra-vinh": "Trà Vinh",
  "long-an": "Long An",
  "binh-phuoc": "Bình Phước",
  "hau-giang": "Hậu Giang",
  "tien-giang": "Tiền Giang",
  "kien-giang": "Kiên Giang",
  "da-lat": "Đà Lạt",
};

/** Different sites spell the same station differently. */
const ALIASES: Record<string, string> = {
  hcm: "tp-hcm",
  tphcm: "tp-hcm",
  "tp-ho-chi-minh": "tp-hcm",
  "ho-chi-minh": "tp-hcm",
  "ba-ria-vung-tau": "vung-tau",
  "lam-dong": "da-lat",
};

/**
 * Southern stations in the order they appear on the ticket for each weekday
 * (0 = Sunday). The 1st and 2nd station drive the Day shift's pos rows, so the
 * order matters and must not depend on whichever site answered first.
 */
const MN_SCHEDULE: Record<number, string[]> = {
  0: ["tien-giang", "kien-giang", "da-lat"],
  1: ["tp-hcm", "dong-thap", "ca-mau"],
  2: ["ben-tre", "vung-tau", "bac-lieu"],
  3: ["dong-nai", "can-tho", "soc-trang"],
  4: ["tay-ninh", "an-giang", "binh-thuan"],
  5: ["vinh-long", "binh-duong", "tra-vinh"],
  6: ["tp-hcm", "long-an", "binh-phuoc", "hau-giang"],
};

/** Lower-case ASCII, hyphen separated: "Đồng Tháp" -> "dong-thap". */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stationSlug(rawName: string): string {
  const slug = slugify(rawName);
  return ALIASES[slug] ?? slug;
}

export function stationName(slug: string, fallback?: string): string {
  return STATION_NAMES[slug] ?? fallback ?? slug;
}

/** Expected southern stations for a date, in ticket order. */
export function scheduledStations(dateKey: string): string[] {
  return MN_SCHEDULE[weekdayOf(dateKey)];
}

/** Sort key: scheduled position first, unknown stations afterwards. */
export function stationOrder(dateKey: string, slug: string): number {
  const idx = scheduledStations(dateKey).indexOf(slug);
  return idx === -1 ? 100 : idx;
}
