"""UN/LOCODE → Hafenname (kompakte Liste)."""
from __future__ import annotations

LOCODE: dict[str, str] = {
    # Asien
    "CN SHA": "Shanghai (CN)", "CN NGB": "Ningbo (CN)", "CN SZN": "Shenzhen (CN)",
    "CN HKG": "Hongkong (CN)", "HK HKG": "Hongkong", "CN QIN": "Qingdao (CN)",
    "CN TXG": "Tianjin (CN)", "CN YTN": "Yantian (CN)", "CN XMN": "Xiamen (CN)",
    "CN DLC": "Dalian (CN)", "SG SIN": "Singapur", "KR PUS": "Busan (KR)",
    "KR INC": "Incheon (KR)", "JP TYO": "Tokio (JP)", "JP YOK": "Yokohama (JP)",
    "JP UKB": "Kobe (JP)", "JP NGO": "Nagoya (JP)", "TW KEL": "Keelung (TW)",
    "TW KHH": "Kaohsiung (TW)", "MY PKG": "Port Klang (MY)",
    "MY TPP": "Tanjung Pelepas (MY)", "VN SGN": "Ho-Chi-Minh-Stadt (VN)",
    "VN HPH": "Haiphong (VN)", "TH LCH": "Laem Chabang (TH)",
    "TH BKK": "Bangkok (TH)", "ID JKT": "Jakarta (ID)", "PH MNL": "Manila (PH)",
    "IN NSA": "Nhava Sheva / Mumbai (IN)", "IN MAA": "Chennai (IN)",
    "IN MUN": "Mundra (IN)", "LK CMB": "Colombo (LK)", "AE DXB": "Dubai (AE)",
    "AE JEA": "Jebel Ali (AE)", "SA JED": "Jeddah (SA)", "OM SLL": "Salalah (OM)",
    # Europa
    "DE HAM": "Hamburg (DE)", "DE BRV": "Bremerhaven (DE)",
    "NL RTM": "Rotterdam (NL)", "BE ANR": "Antwerpen (BE)",
    "BE ZEE": "Zeebrugge (BE)", "GB FXT": "Felixstowe (GB)",
    "GB LGP": "London Gateway (GB)", "GB SOU": "Southampton (GB)",
    "GB LIV": "Liverpool (GB)", "FR LEH": "Le Havre (FR)",
    "FR FOS": "Fos-sur-Mer (FR)", "ES VLC": "Valencia (ES)",
    "ES ALG": "Algeciras (ES)", "ES BCN": "Barcelona (ES)",
    "IT GOA": "Genua (IT)", "IT GIT": "Gioia Tauro (IT)",
    "IT SPE": "La Spezia (IT)", "GR PIR": "Piräus (GR)", "MT MLA": "Malta (MT)",
    "DK CPH": "Kopenhagen (DK)", "PL GDN": "Danzig / Gdańsk (PL)",
    "RU LED": "St. Petersburg (RU)", "TR AMB": "Ambarli / Istanbul (TR)",
    # Amerika
    "US LAX": "Los Angeles (US)", "US LGB": "Long Beach (US)",
    "US NYC": "New York / New Jersey (US)", "US SAV": "Savannah (US)",
    "US CHS": "Charleston (US)", "US HOU": "Houston (US)",
    "US OAK": "Oakland (US)", "US SEA": "Seattle (US)",
    "US TIW": "Tacoma (US)", "US MIA": "Miami (US)",
    "CA VAN": "Vancouver (CA)", "CA MTR": "Montréal (CA)",
    "MX VER": "Veracruz (MX)", "MX ZLO": "Manzanillo (MX)",
    "PA BLB": "Balboa / Panama (PA)", "PA MIT": "Manzanillo / Panama (PA)",
    "BR SSZ": "Santos (BR)", "BR ITJ": "Itajaí (BR)",
    # Afrika
    "EG PSD": "Port Said (EG)", "EG SUZ": "Sueskanal (EG)",
    "MA PTM": "Tanger Med (MA)", "ZA DUR": "Durban (ZA)",
    "ZA CPT": "Kapstadt (ZA)",
    # Ozeanien
    "AU SYD": "Sydney (AU)", "AU MEL": "Melbourne (AU)",
    "AU BNE": "Brisbane (AU)", "NZ AKL": "Auckland (NZ)",
}


def lookup(code: str | None) -> str | None:
    if not code:
        return None
    raw = code.strip().upper()
    if not raw:
        return None
    compact = raw.replace(" ", "")
    if len(compact) >= 5:
        normalized = f"{compact[:2]} {compact[2:5]}"
        if normalized in LOCODE:
            return LOCODE[normalized]
    return LOCODE.get(raw, raw)
