/*
  ================================================================
  WEATHER APP — app.js
  ================================================================
  All JavaScript logic lives here. This file handles:
    • API calls to OpenWeatherMap
    • Rendering the weather UI
    • Drawing charts with Chart.js
    • Saving/loading user preferences via localStorage
    • Theme toggle (dark / light mode)
    • Recent city history

  TABLE OF CONTENTS
  ─────────────────────────────────────────────────────────────
  1.  API KEY — ★ PUT YOUR KEY HERE ★
  2.  API endpoint constants
  3.  App state object
  4.  localStorage helpers (save/load preferences)
  5.  Theme management (dark/light)
  6.  Unit toggle
  7.  Recent cities management
  8.  Utility / formatter functions
  9.  Geolocation (use my location)
  10. API fetching functions
  11. Chart rendering (temperature + precipitation)
  12. Main render function (builds all weather cards)
  13. State display helpers (loading, error, idle)
  14. Event listeners (search, location, unit, theme)
  15. App initialisation (runs on page load)
  ================================================================
*/


/* ================================================================
  1. API KEY ★
  ================================================================

  ★★★  PASTE YOUR OPENWEATHERMAP API KEY BELOW  ★★★

  How to get a free API key:
    1. Go to https://openweathermap.org/api
    2. Click "Sign Up" — no credit card needed
    3. After signing up, go to your profile → "My API Keys"
    4. Copy the default key (or generate a new one)
    5. Paste it below, replacing "YOUR_API_KEY_HERE"

  IMPORTANT: New keys can take up to 10 minutes to activate.
  If you get a 401 error, wait a few minutes and try again.

  Free tier limits (as of 2024):
    • 1,000 API calls per day
    • 60 calls per minute
    • Includes: current weather, 5-day forecast, air pollution,
                geocoding (city name → coordinates)
================================================================ */
const API_KEY = "76fa029bd344cb7c3e0850a3a5508966";   /* ← ★ paste your key here ★ */


/* ================================================================
  2. API ENDPOINT CONSTANTS
  ================================================================
  These point to the OpenWeatherMap v2.5 API.
  You shouldn't need to change these unless OWM updates their API.
================================================================ */
const OWM_BASE  = "https://api.openweathermap.org/data/2.5";
const OWM_GEO   = "https://api.openweathermap.org/geo/1.0";

/*
  OWM Endpoints used:
    ${OWM_GEO}/direct        → City name → lat/lon (geocoding)
    ${OWM_BASE}/weather      → Current conditions
    ${OWM_BASE}/forecast     → 5-day / 3-hour forecast
    ${OWM_BASE}/air_pollution → Air quality index
*/


/* ================================================================
  3. APP STATE
  ================================================================
  A single object that holds everything the UI depends on.
  This makes it easy to re-render after changing a preference
  (like the unit) without re-fetching from the API.

  state.unit     : "metric" = °C, m/s  |  "imperial" = °F, mph
  state.current  : OWM /weather response object (or null)
  state.forecast : OWM /forecast response object (or null)
  state.airQuality: OWM /air_pollution response object (or null)
  state.theme    : "light" | "dark"
  state.charts   : Chart.js instances (kept so we can destroy/redraw)
================================================================ */
const state = {
  unit:        "metric",      /* temperature unit preference */
  current:     null,          /* current weather data */
  forecast:    null,          /* forecast data */
  airQuality:  null,          /* air quality data */
  theme:       "light",       /* colour theme preference */
  charts: {
    temp:  null,              /* Chart.js instance for temp chart */
    precip: null,             /* Chart.js instance for precip chart */
  },
};


/* ================================================================
  4. LOCALSTORAGE HELPERS
  ================================================================
  These functions read and write user preferences to localStorage.
  localStorage persists across browser sessions (unlike sessionStorage).

  KEYS STORED:
    "weather_unit"   : "metric" or "imperial"
    "weather_theme"  : "light" or "dark"
    "weather_recent" : JSON array of up to 5 city name strings
    "weather_last"   : JSON string of last fetched coords { lat, lon, name }

  NOTE: localStorage only stores strings, so objects/arrays must
  be serialised with JSON.stringify() and parsed with JSON.parse().
================================================================ */

/**
 * Save a single preference value to localStorage.
 * @param {string} key   - The localStorage key
 * @param {*}      value - The value to save (will be JSON stringified)
 */
function savePref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* localStorage can be disabled in private/incognito mode */
    console.warn("Could not save to localStorage:", e);
  }
}

/**
 * Load a single preference value from localStorage.
 * @param {string} key          - The localStorage key
 * @param {*}      defaultValue - Value to return if the key doesn't exist
 * @returns {*} The stored value, or defaultValue if not found
 */
function loadPref(key, defaultValue = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

/**
 * Load all saved preferences into state and apply them to the UI.
 * Called once when the app initialises.
 */
function loadAllPrefs() {
  /* Load saved unit preference */
  state.unit  = loadPref("weather_unit",  "metric");

  /* Load saved theme preference */
  state.theme = loadPref("weather_theme", "light");

  /* Apply the loaded preferences to the UI */
  applyTheme(state.theme);
  applyUnit(state.unit);
}


/* ================================================================
  5. THEME MANAGEMENT — dark / light mode
  ================================================================
  The theme is controlled by a data-theme attribute on <html>.
  CSS uses [data-theme="dark"] selectors to apply dark colours.
  See style.css section 2 for the colour overrides.
================================================================ */

/**
 * Apply a theme to the page.
 * @param {"light"|"dark"} theme
 */
function applyTheme(theme) {
  /* Set the attribute that CSS reads */
  document.documentElement.setAttribute("data-theme", theme);

  /* Update the toggle button icon */
  const icon = document.getElementById("themeIcon");
  if (icon) {
    icon.textContent = theme === "dark" ? "☀" : "◑";
  }

  /* Keep state in sync */
  state.theme = theme;

  /* If charts exist, redraw them so they use the right colours */
  if (state.forecast) {
    renderCharts();
  }
}

/**
 * Toggle between light and dark mode, then save the preference.
 * Called by the theme toggle button event listener.
 */
function toggleTheme() {
  const next = state.theme === "light" ? "dark" : "light";
  applyTheme(next);
  savePref("weather_theme", next);   /* persist to localStorage */
}


/* ================================================================
  6. UNIT TOGGLE — °C / °F
================================================================ */

/**
 * Apply a unit preference to the UI toggle buttons.
 * @param {"metric"|"imperial"} unit
 */
function applyUnit(unit) {
  state.unit = unit;

  /* Highlight the active button */
  document.querySelectorAll(".unit-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.unit === unit);
  });
}

/**
 * Switch the temperature unit and re-render the current weather data.
 * @param {"metric"|"imperial"} unit
 */
function setUnit(unit) {
  applyUnit(unit);
  savePref("weather_unit", unit);    /* persist to localStorage */

  /* Re-render with the new unit (no new API call needed) */
  if (state.current) render();
}


/* ================================================================
  7. RECENT CITIES MANAGEMENT
  ================================================================
  Stores up to MAX_RECENT recently searched city names in localStorage.
  Clicking a recent city re-runs fetchByCity() for that city.
================================================================ */

const MAX_RECENT = 5;   /* maximum number of recent cities to show */

/**
 * Add a city name to the recent searches list and persist it.
 * Duplicates are removed (city always moves to the top).
 * @param {string} cityName - e.g. "London"
 */
function saveRecentCity(cityName) {
  let recent = loadPref("weather_recent", []);

  /* Remove if already in list (so it moves to the top) */
  recent = recent.filter(c => c.toLowerCase() !== cityName.toLowerCase());

  /* Add to the front */
  recent.unshift(cityName);

  /* Keep the list within MAX_RECENT */
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);

  savePref("weather_recent", recent);
  renderRecentCities(recent);
}

/**
 * Render the recent cities list in the sidebar.
 * @param {string[]} [recent] - Optional array; loads from localStorage if omitted
 */
function renderRecentCities(recent) {
  recent = recent ?? loadPref("weather_recent", []);

  const section = document.getElementById("recentSection");
  const list    = document.getElementById("recentList");
  if (!section || !list) return;

  if (!recent.length) {
    /* Hide the section entirely if there are no recent cities */
    section.style.display = "none";
    return;
  }

  section.style.display = "flex";

  /* Build one chip per recent city */
  list.innerHTML = recent.map(city => `
    <button class="recent-chip" data-city="${city}">${city}</button>
  `).join("");

  /* Attach click handlers to each chip */
  list.querySelectorAll(".recent-chip").forEach(chip => {
    chip.addEventListener("click", () => fetchByCity(chip.dataset.city));
  });
}


/* ================================================================
  8. UTILITY & FORMATTER FUNCTIONS
  ================================================================
  Pure functions — they take a value and return a formatted string.
  No side effects, easy to test and customise.
================================================================ */

/**
 * Format a temperature (given in Celsius) as a string.
 * Automatically converts to °F if state.unit is "imperial".
 * Math.round() prevents ugly floats like "18.0000001°C".
 * @param {number} celsius
 * @returns {string} e.g. "18°C" or "64°F"
 */
function fmtTemp(celsius) {
  if (state.unit === "imperial") {
    return Math.round(celsius * 9 / 5 + 32) + "°F";
  }
  return Math.round(celsius) + "°C";
}

/**
 * Format a raw Celsius number for chart labels (no unit symbol).
 * Used when the unit symbol is shown once in the chart title.
 * @param {number} celsius
 * @returns {number}
 */
function rawTemp(celsius) {
  if (state.unit === "imperial") {
    return Math.round(celsius * 9 / 5 + 32);
  }
  return Math.round(celsius);
}

/**
 * Format wind speed.
 * OWM always returns wind in m/s; we convert to mph for imperial.
 * @param {number} mps - metres per second
 * @returns {string} e.g. "5 m/s" or "11 mph"
 */
function fmtWind(mps) {
  if (state.unit === "imperial") {
    return Math.round(mps * 2.237) + " mph";
  }
  return Math.round(mps) + " m/s";
}

/**
 * Convert compass degrees to a cardinal direction label.
 * @param {number} deg - 0–360 degrees
 * @returns {string} e.g. "NW"
 */
function windDir(deg) {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((deg ?? 0) / 45) % 8];
}

/**
 * Format visibility (given in metres by OWM).
 * Shows km when >= 1000 m, otherwise shows metres.
 * @param {number} metres
 * @returns {string} e.g. "9.5 km" or "800 m"
 */
function fmtVis(metres) {
  if (metres >= 1000) return (metres / 1000).toFixed(1) + " km";
  return metres + " m";
}

/**
 * Format pressure (given in hPa by OWM).
 * hPa is the same as millibar (mbar).
 * @param {number} hpa
 * @returns {string} e.g. "1013 hPa"
 */
function fmtPressure(hpa) {
  return hpa + " hPa";
}

/**
 * Convert a Unix timestamp (seconds since epoch) to a readable time.
 * Uses the user's local timezone automatically.
 * @param {number} unix - Unix timestamp in seconds
 * @returns {string} e.g. "7:30 AM"
 */
function fmtTime(unix) {
  return new Date(unix * 1000).toLocaleTimeString([], {
    hour:   "2-digit",
    minute: "2-digit",
  });
}

/**
 * Convert a Unix timestamp to a short day name.
 * @param {number} unix
 * @returns {string} e.g. "Mon"
 */
function fmtDay(unix) {
  return new Date(unix * 1000).toLocaleDateString([], { weekday: "short" });
}

/**
 * Convert a Unix timestamp to a short hour label.
 * @param {number} unix
 * @returns {string} e.g. "3 PM"
 */
function fmtHour(unix) {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: "numeric" });
}

/**
 * Map an OWM weather icon code to an emoji or symbol.
 * OWM icon codes: https://openweathermap.org/weather-conditions
 *
 * To use colour emoji instead of minimal symbols, replace the
 * values in the map with emoji like ☀️, ⛅, 🌧, etc.
 * To use image icons, return an <img> tag string here and
 * update the rendering code in render() accordingly.
 *
 * @param {string} code - OWM icon code e.g. "01d"
 * @returns {string} A single character or emoji
 */
function weatherEmoji(code) {
  const map = {
    /* Day icons */
    "01d": "☀️",   /* clear sky          */
    "02d": "⛅",   /* few clouds         */
    "03d": "☁️",  /* scattered clouds   */
    "04d": "☁️",  /* broken clouds      */
    "09d": "🌧️", /* shower rain        */
    "10d": "🌦️", /* rain               */
    "11d": "⛈️",  /* thunderstorm       */
    "13d": "❄️",  /* snow               */
    "50d": "🌫️", /* mist / fog         */
    /* Night icons */
    "01n": "🌙",   /* clear sky night    */
    "02n": "🌤️", /* few clouds night   */
    "03n": "☁️",  /* scattered clouds   */
    "04n": "☁️",  /* broken clouds      */
    "09n": "🌧️", /* shower rain        */
    "10n": "🌧️", /* rain               */
    "11n": "⛈️",  /* thunderstorm       */
    "13n": "❄️",  /* snow               */
    "50n": "🌫️", /* mist               */
  };
  return map[code] || "🌡️";
}

/**
 * Get AQI label and badge colours for a given OWM AQI index (1–5).
 * OWM AQI scale: 1=Good, 2=Fair, 3=Moderate, 4=Poor, 5=Very Poor
 *
 * Change the bg / color values to restyle the AQI badges.
 *
 * @param {number} index - AQI index (1–5)
 * @returns {{ label: string, bg: string, color: string }}
 */
function aqiInfo(index) {
  const table = [
    null,                                                          /* 0 — unused */
    { label: "Good",      bg: "#d1fae5", color: "#065f46" },      /* 1          */
    { label: "Fair",      bg: "#d9f99d", color: "#365314" },      /* 2          */
    { label: "Moderate",  bg: "#fef9c3", color: "#713f12" },      /* 3          */
    { label: "Poor",      bg: "#ffedd5", color: "#7c2d12" },      /* 4          */
    { label: "Very poor", bg: "#fee2e2", color: "#7f1d1d" },      /* 5          */
  ];
  return table[index] ?? { label: "–", bg: "transparent", color: "inherit" };
}

/**
 * Group the 5-day/3-hour OWM forecast list into calendar days.
 * For each day, picks the highest temperature as "high",
 * lowest as "low", and uses the midday slot's icon/description.
 *
 * @param {Object[]} list - OWM forecast list array (up to 40 items)
 * @returns {Object[]} Array of up to 5 daily summary objects
 */
function buildDailyForecast(list) {
  const days = {};

  list.forEach(item => {
    /* Use the date string as a grouping key (e.g. "Mon Apr 14 2025") */
    const key = new Date(item.dt * 1000).toDateString();

    if (!days[key]) {
      days[key] = { dt: item.dt, items: [] };
    }
    days[key].items.push(item);
  });

  return Object.values(days).slice(0, 5).map(day => {
    const temps = day.items.map(i => i.main.temp);
    const mid   = day.items[Math.floor(day.items.length / 2)];

    return {
      dt:   day.dt,
      high: Math.round(Math.max(...temps)),
      low:  Math.round(Math.min(...temps)),
      icon: mid.weather[0].icon,
      desc: mid.weather[0].description,
      /* Raw items array — used by chart to get temperatures by hour */
      items: day.items,
    };
  });
}

/**
 * Get computed CSS variable values — used when building Chart.js
 * datasets so the charts respect the current theme.
 *
 * @param {string} varName - CSS variable name e.g. "--c-accent"
 * @returns {string} The computed colour value
 */
function cssVar(varName) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
}


/* ================================================================
  9. GEOLOCATION — use my location
================================================================ */

/**
 * Ask the browser for the user's GPS coordinates, then fetch
 * weather for that position. Shows a loading state while waiting.
 *
 * The browser will show a permission prompt automatically.
 * If denied, we fall back to an error message.
 */
function useMyLocation() {
  /* Check if the browser supports Geolocation at all */
  if (!navigator.geolocation) {
    showError("Geolocation isn't supported by this browser. Please search by city name.");
    return;
  }

  showLoading();

  navigator.geolocation.getCurrentPosition(
    /* Success: got coordinates */
    pos => {
      fetchByCoords(pos.coords.latitude, pos.coords.longitude);
    },

    /* Error: permission denied or timeout */
    err => {
      showError("Location access was denied. Please search by city name instead.");
      console.warn("Geolocation error:", err.message);
    },

    /* Options */
    {
      timeout:            10_000,   /* give up after 10 seconds  */
      enableHighAccuracy: false,    /* false = faster, uses cell tower */
    }
  );
}


/* ================================================================
  10. API FETCHING FUNCTIONS
================================================================ */

/**
 * Fetch weather data for a city name.
 * Uses the OWM Geocoding API to convert the name to lat/lon first.
 *
 * @param {string} city - City name string e.g. "Paris" or "Paris, FR"
 */
async function fetchByCity(city) {
  showLoading();

  try {
    /* Step 1: geocode the city name to coordinates */
    const geoRes  = await fetch(`${OWM_GEO}/direct?q=${encodeURIComponent(city)}&limit=1&appid=${API_KEY}`);
    const geoData = await geoRes.json();

    /* No results means the city name wasn't recognised */
    if (!geoData.length) {
      throw new Error(`"${city}" not found. Try adding a country code, e.g. "Springfield, US"`);
    }

    /* Save city to recent searches using the display name from OWM */
    const displayName = geoData[0].name;
    saveRecentCity(displayName);

    /* Step 2: fetch weather at the resolved coordinates */
    await fetchByCoords(geoData[0].lat, geoData[0].lon);

  } catch (err) {
    showError(err.message);
  }
}

/**
 * Fetch weather data for a specific lat/lon position.
 * This is the core fetch function — all weather data is loaded here.
 *
 * Fires three parallel requests to OWM:
 *   1. Current conditions  (/weather)
 *   2. 5-day forecast      (/forecast)
 *   3. Air quality index   (/air_pollution)
 *
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 */
async function fetchByCoords(lat, lon) {
  showLoading();

  try {
    /* Fire all three requests at the same time (Promise.all = parallel) */
    const [curRes, fcRes, aqRes] = await Promise.all([
      fetch(`${OWM_BASE}/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`),
      fetch(`${OWM_BASE}/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&cnt=40`),
      fetch(`${OWM_BASE}/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`),
    ]);

    /* ── Error handling ── */
    if (curRes.status === 401) {
      throw new Error("Invalid API key. Check that you pasted it correctly and that it has activated (new keys can take up to 10 minutes).");
    }
    if (curRes.status === 429) {
      throw new Error("API rate limit reached. Please wait a moment and try again.");
    }
    if (!curRes.ok) {
      throw new Error(`Weather data unavailable (HTTP ${curRes.status})`);
    }

    /* ── Parse JSON ── */
    state.current    = await curRes.json();
    state.forecast   = fcRes.ok  ? await fcRes.json()  : null;
    state.airQuality = aqRes.ok  ? await aqRes.json()  : null;

    /* Save the last searched location so we can reload it on next visit */
    savePref("weather_last", {
      lat,
      lon,
      name: state.current.name,
    });

    /* Build and display the weather UI */
    render();

  } catch (err) {
    showError(err.message);
    console.error("Weather fetch error:", err);
  }
}


/* ================================================================
  11. CHART RENDERING
  ================================================================
  Two charts are rendered using Chart.js:
    • Temperature line chart (24 hours)
    • Precipitation bar chart (24 hours)

  Charts are destroyed before being redrawn to prevent the
  "Canvas is already in use" error from Chart.js.

  Chart.js docs: https://www.chartjs.org/docs/latest/
  To change chart type, replace "line" or "bar" with another type.
  To change colours, update the CSS variables in style.css.
================================================================ */

/**
 * Render (or re-render) both charts using the current forecast data.
 * Safe to call multiple times — destroys old chart instances first.
 */
function renderCharts() {
  if (!state.forecast) return;

  /* Get the next 8 forecast slots (= 24 hours, every 3h) */
  const slots = state.forecast.list.slice(0, 8);

  /* Labels: short hour strings e.g. ["3 PM", "6 PM", ...] */
  const labels = slots.map(s => fmtHour(s.dt));

  /* Temperature data in the user's chosen unit */
  const tempData  = slots.map(s => rawTemp(s.main.temp));

  /* Feels-like data for a second line on the temp chart */
  const feelsData = slots.map(s => rawTemp(s.main.feels_like));

  /* Precipitation probability (0–1 → 0–100%) */
  const rainData  = slots.map(s => Math.round((s.pop ?? 0) * 100));

  /* Humidity percentage */
  const humidData = slots.map(s => s.main.humidity);

  /* Read current theme colours from CSS */
  const accentColor   = cssVar("--c-chart-temp");     /* purple */
  const rainColor     = cssVar("--c-chart-rain");     /* blue   */
  const humidColor    = cssVar("--c-chart-humidity"); /* green  */
  const mutedColor    = cssVar("--c-muted");
  const borderColor   = cssVar("--c-border");
  const textColor     = cssVar("--c-text");

  /* Unit label for the temperature axis */
  const unitLabel = state.unit === "metric" ? "°C" : "°F";

  /* ────────────────────────────────────────────────────────
    SHARED CHART.JS OPTIONS
    These options apply to both charts.
    See https://www.chartjs.org/docs/latest/configuration/
  ──────────────────────────────────────────────────────── */
  const sharedOptions = {
    responsive: true,
    maintainAspectRatio: false,   /* lets the CSS control the height */
    interaction: {
      /* Show tooltip for all datasets at the same x position */
      mode: "index",
      intersect: false,
    },
    plugins: {
      legend: {
        /* We use our own HTML legend above the chart */
        display: false,
      },
      tooltip: {
        /* Rounded tooltip background */
        backgroundColor: cssVar("--c-surface"),
        titleColor:      textColor,
        bodyColor:       mutedColor,
        borderColor:     borderColor,
        borderWidth:     1,
        padding:         10,
        cornerRadius:    8,
        /* Prefix each value with the dataset's unit */
        callbacks: {
          title: items => items[0].label,
        },
      },
    },
    scales: {
      x: {
        grid: {
          /* Vertical grid lines — hidden for a cleaner look */
          display: false,
        },
        ticks: {
          color: mutedColor,
          font: { size: 11 },
          /* Only show every other label to avoid crowding */
          maxTicksLimit: 8,
        },
        border: { display: false },
      },
      y: {
        grid: {
          color: borderColor,
          lineWidth: 1,
        },
        ticks: {
          color: mutedColor,
          font: { size: 11 },
          maxTicksLimit: 5,
        },
        border: { display: false, dash: [3, 3] },
      },
    },
  };

  /* ────────────────────────────────────────────────────────
    CHART 1: TEMPERATURE LINE CHART
    Two lines: actual temperature + feels-like temperature.
    Uses a transparent gradient fill under the main line.
  ──────────────────────────────────────────────────────── */

  /* Destroy the previous chart instance if it exists */
  if (state.charts.temp) {
    state.charts.temp.destroy();
    state.charts.temp = null;
  }

  const tempCanvas = document.getElementById("chartTemp");
  if (tempCanvas) {
    const ctx = tempCanvas.getContext("2d");

    /*
      Gradient fill under the temperature line.
      Goes from a semi-transparent accent colour at top to transparent at bottom.
      To remove the fill, delete the "backgroundColor" key from dataset 0 below.
    */
    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0,   "rgba(124, 106, 247, 0.2)");
    gradient.addColorStop(1,   "rgba(124, 106, 247, 0.0)");

    state.charts.temp = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            /* Main temperature line */
            label:           `Temp (${unitLabel})`,
            data:            tempData,
            borderColor:     accentColor,
            backgroundColor: gradient,
            borderWidth:     2,
            tension:         0.4,          /* curve smoothness 0=straight 1=curvy */
            pointRadius:     3,
            pointHoverRadius:6,
            pointBackgroundColor: accentColor,
            fill: true,                    /* fill under the line with gradient */
          },
          {
            /* Feels-like temperature line (dashed) */
            label:       `Feels like (${unitLabel})`,
            data:        feelsData,
            borderColor: mutedColor,
            borderWidth: 1.5,
            borderDash:  [4, 4],           /* dashed line style */
            tension:     0.4,
            pointRadius: 0,                /* hide dots on the dashed line */
            fill:        false,
          },
        ],
      },
      options: {
        ...sharedOptions,
        plugins: {
          ...sharedOptions.plugins,
          tooltip: {
            ...sharedOptions.plugins.tooltip,
            callbacks: {
              label: item => `${item.dataset.label}: ${item.formattedValue}${unitLabel}`,
            },
          },
        },
        scales: {
          ...sharedOptions.scales,
          y: {
            ...sharedOptions.scales.y,
            ticks: {
              ...sharedOptions.scales.y.ticks,
              /* Add the unit symbol after each y-axis tick */
              callback: val => val + unitLabel,
            },
          },
        },
      },
    });
  }

  /* ────────────────────────────────────────────────────────
    CHART 2: PRECIPITATION + HUMIDITY CHART
    Bars: rain probability (%)
    Line: humidity (%)
    Uses a second y-axis so both datasets share the 0–100% range.
  ──────────────────────────────────────────────────────── */

  /* Destroy the previous chart instance if it exists */
  if (state.charts.precip) {
    state.charts.precip.destroy();
    state.charts.precip = null;
  }

  const precipCanvas = document.getElementById("chartPrecip");
  if (precipCanvas) {
    const ctx2 = precipCanvas.getContext("2d");

    state.charts.precip = new Chart(ctx2, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            /* Rain probability bars */
            label:           "Rain chance (%)",
            data:            rainData,
            backgroundColor: "rgba(96, 165, 250, 0.5)",   /* semi-transparent blue */
            borderColor:     rainColor,
            borderWidth:     1,
            borderRadius:    4,           /* rounded tops on bars */
            yAxisID:         "y",
          },
          {
            /* Humidity line overlaid on the bar chart */
            label:           "Humidity (%)",
            data:            humidData,
            type:            "line",      /* mixed chart type */
            borderColor:     humidColor,
            backgroundColor: "transparent",
            borderWidth:     2,
            tension:         0.4,
            pointRadius:     3,
            pointHoverRadius:6,
            pointBackgroundColor: humidColor,
            yAxisID:         "y",
            fill:            false,
          },
        ],
      },
      options: {
        ...sharedOptions,
        plugins: {
          ...sharedOptions.plugins,
          tooltip: {
            ...sharedOptions.plugins.tooltip,
            callbacks: {
              label: item => `${item.dataset.label}: ${item.formattedValue}%`,
            },
          },
        },
        scales: {
          ...sharedOptions.scales,
          y: {
            ...sharedOptions.scales.y,
            /* Both datasets use the same 0–100 axis */
            min: 0,
            max: 100,
            ticks: {
              ...sharedOptions.scales.y.ticks,
              callback: val => val + "%",
            },
          },
        },
      },
    });
  }
}


/* ================================================================
  12. MAIN RENDER FUNCTION
  ================================================================
  Reads from state.current / state.forecast / state.airQuality
  and builds the complete weather UI inside #content.

  Called:
    • After every successful API fetch
    • When the user switches the temperature unit
    • When the theme changes (to redraw charts with new colours)
================================================================ */
function render() {
  const w  = state.current;
  const fl = state.forecast;
  if (!w) return;

  /* ── Extract values from the OWM response ── */
  const tempC    = w.main.temp;
  const feelsC   = w.main.feels_like;
  const minC     = w.main.temp_min;
  const maxC     = w.main.temp_max;
  const humidity = w.main.humidity;        /* % */
  const pressure = w.main.pressure;        /* hPa */
  const windSpd  = w.wind.speed;           /* m/s */
  const windDeg  = w.wind.deg ?? 0;        /* degrees */
  const vis      = w.visibility ?? 0;      /* metres */
  const sunrise  = w.sys.sunrise;          /* unix */
  const sunset   = w.sys.sunset;           /* unix */
  const desc     = w.weather[0].description;
  const icon     = w.weather[0].icon;
  const cityName = w.name;
  const country  = w.sys.country;

  /* Visibility as percentage of 10 km maximum */
  const visPct = Math.min(100, Math.round((vis / 10_000) * 100));

  /* Last-updated time */
  const updated = fmtTime(w.dt);

  /* ── Air quality ── */
  const aqi     = state.airQuality?.list?.[0]?.main?.aqi ?? null;
  const aqiData = aqi ? aqiInfo(aqi) : null;
  const aqiBadge = aqiData
    ? `<span class="aqi-pill" style="background:${aqiData.bg};color:${aqiData.color}">`
    + `AQI ${aqi} · ${aqiData.label}</span>`
    : "";

  /* ── Forecast arrays ── */
  const daily  = fl ? buildDailyForecast(fl.list) : [];
  const hourly = fl ? fl.list.slice(0, 8)          : [];

  /* ── Build hourly strip HTML ── */
  const hourlyHTML = hourly.map(h => {
    const rainPct = h.pop ? Math.round(h.pop * 100) : 0;
    return `
      <div class="hour-block">
        <div class="hour-time">${fmtHour(h.dt)}</div>
        <div class="hour-icon">${weatherEmoji(h.weather[0].icon)}</div>
        <div class="hour-temp">${fmtTemp(h.main.temp)}</div>
        ${rainPct > 0 ? `<div class="hour-rain">${rainPct}%</div>` : ""}
      </div>`;
  }).join("");

  /* ── Build 5-day forecast rows HTML ── */
  const dailyHTML = daily.map((d, i) => `
    <div class="day-row">
      <div class="day-name">${i === 0 ? "Today" : fmtDay(d.dt)}</div>
      <div class="day-icon">${weatherEmoji(d.icon)}</div>
      <div class="day-desc">${d.desc}</div>
      <div class="day-temps">
        <div class="day-high">${fmtTemp(d.high)}</div>
        <div class="day-low">${fmtTemp(d.low)}</div>
      </div>
    </div>`
  ).join("");

  /* ── Write all cards into #content ── */
  document.getElementById("content").innerHTML = `

    <!-- ======================================================
      CARD 1: Current conditions
    ====================================================== -->
    <div class="card animate-in">

      <!-- City name, big temperature, emoji, description -->
      <div class="current-body">
        <div class="current-top">
          <div class="city-name">${cityName}${aqiBadge}</div>
          <div class="city-meta">${country} · Updated ${updated}</div>
        </div>

        <div class="temp-row">
          <div class="temp-number">${fmtTemp(tempC)}</div>
          <div class="weather-emoji">${weatherEmoji(icon)}</div>
        </div>

        <div class="weather-desc">${desc}</div>

        <div class="high-low">
          <span class="high">↑ ${fmtTemp(maxC)}</span>
          <span>↓ ${fmtTemp(minC)}</span>
        </div>
      </div>

      <!-- Stats grid: feels like, humidity, wind, pressure, visibility -->
      <div class="stats-grid">

        <div class="stat-cell">
          <div class="stat-label">Feels like</div>
          <div class="stat-value">${fmtTemp(feelsC)}</div>
        </div>

        <div class="stat-cell">
          <div class="stat-label">Humidity</div>
          <div class="stat-value">${humidity}%</div>
        </div>

        <div class="stat-cell">
          <div class="stat-label">Wind</div>
          <div class="stat-value">${fmtWind(windSpd)}</div>
          <div class="stat-sub">${windDir(windDeg)}</div>
        </div>

        <div class="stat-cell">
          <div class="stat-label">Pressure</div>
          <div class="stat-value">${fmtPressure(pressure)}</div>
        </div>

        <!-- Visibility — spans full width -->
        <div class="stat-cell stat-full">
          <div class="stat-label">Visibility</div>
          <div class="stat-value">${fmtVis(vis)}</div>
          <div class="vis-bar">
            <div class="vis-fill" style="width: ${visPct}%"></div>
          </div>
        </div>

      </div><!-- end .stats-grid -->

      <!-- Sunrise / sunset -->
      <div class="sun-row">
        <div class="sun-cell">
          <div class="sun-label">Sunrise</div>
          <div class="sun-time">${fmtTime(sunrise)}</div>
        </div>
        <div class="sun-cell">
          <div class="sun-label">Sunset</div>
          <div class="sun-time">${fmtTime(sunset)}</div>
        </div>
      </div>

    </div><!-- end card 1 -->

    <!-- ======================================================
      CARD 2: Hourly forecast strip (next 24 hours)
    ====================================================== -->
    <div class="card animate-in">
      <div class="section-label">Next 24 hours</div>
      <div class="hourly-strip">${hourlyHTML}</div>
    </div>

    <!-- ======================================================
      CARD 3: Temperature chart (24 hours)
      The <canvas> is drawn into by Chart.js in renderCharts().
    ====================================================== -->
    <div class="card animate-in">
      <div class="chart-card">
        <div class="chart-header">
          <div class="chart-title">Temperature (24 h)</div>
          <div class="chart-legend">
            <div class="legend-item">
              <div class="legend-dot" style="background: var(--c-chart-temp)"></div>
              Temp
            </div>
            <div class="legend-item">
              <div class="legend-dot" style="background: var(--c-muted)"></div>
              Feels like
            </div>
          </div>
        </div>
        <!-- Chart.js draws inside this canvas -->
        <div class="chart-wrap">
          <canvas id="chartTemp"></canvas>
        </div>
      </div>
    </div>

    <!-- ======================================================
      CARD 4: Precipitation + humidity chart (24 hours)
    ====================================================== -->
    <div class="card animate-in">
      <div class="chart-card">
        <div class="chart-header">
          <div class="chart-title">Rain & Humidity (24 h)</div>
          <div class="chart-legend">
            <div class="legend-item">
              <div class="legend-dot" style="background: var(--c-chart-rain)"></div>
              Rain %
            </div>
            <div class="legend-item">
              <div class="legend-dot" style="background: var(--c-chart-humidity)"></div>
              Humidity
            </div>
          </div>
        </div>
        <div class="chart-wrap">
          <canvas id="chartPrecip"></canvas>
        </div>
      </div>
    </div>

    <!-- ======================================================
      CARD 5: 5-day forecast
    ====================================================== -->
    <div class="card animate-in">
      <div class="section-label">5-day forecast</div>
      ${dailyHTML}
    </div>

  `;

  /*
    Draw the charts AFTER innerHTML is set, so the <canvas> elements
    exist in the DOM before Chart.js tries to find them.
    requestAnimationFrame waits one paint cycle for safety.
  */
  requestAnimationFrame(() => renderCharts());
}


/* ================================================================
  13. STATE DISPLAY HELPERS — loading / error / idle
================================================================ */

/**
 * Show a loading indicator in the content area.
 * The .loading-pulse class adds a CSS animation (style.css section 19).
 */
function showLoading() {
  document.getElementById("content").innerHTML = `
    <div class="state-card">
      <div class="state-icon loading-pulse">○</div>
      <div class="state-text">Loading weather data…</div>
    </div>`;
}

/**
 * Show an error message in the content area.
 * @param {string} msg - Human-readable error description
 */
function showError(msg) {
  document.getElementById("content").innerHTML = `
    <div class="state-card">
      <div class="state-icon">×</div>
      <div class="state-text">${msg}</div>
    </div>`;
}


/* ================================================================
  14. EVENT LISTENERS
  ================================================================
  All user interactions are wired up here.
  Keeping listeners here (rather than inline in HTML) makes it
  easy to find and modify them without touching the HTML file.
================================================================ */

/* ── Search button click ── */
document.getElementById("searchBtn").addEventListener("click", () => {
  const city = document.getElementById("cityInput").value.trim();
  if (city) fetchByCity(city);
});

/* ── Enter key inside the search input ── */
document.getElementById("cityInput").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    const city = document.getElementById("cityInput").value.trim();
    if (city) fetchByCity(city);
  }
});

/* ── "Use my location" button ── */
document.getElementById("locBtn").addEventListener("click", useMyLocation);

/* ── Theme toggle button ── */
document.getElementById("themeToggle").addEventListener("click", toggleTheme);

/* ── Unit toggle buttons (°C / °F) ──
   We use event delegation on the parent .unit-toggle container
   so we only need one listener instead of one per button. */
document.querySelector(".unit-toggle").addEventListener("click", e => {
  /* Check if the clicked element (or its ancestor) is a .unit-btn */
  const btn = e.target.closest(".unit-btn");
  if (!btn) return;

  const unit = btn.dataset.unit;   /* "metric" or "imperial" */
  if (unit && unit !== state.unit) {
    setUnit(unit);
  }
});


/* ================================================================
  15. APP INITIALISATION
  ================================================================
  Runs once when the page loads (because the <script> tag in
  index.html has the "defer" attribute, so this runs after the
  DOM is fully parsed).
================================================================ */

(function init() {
  /* Step 1: Load saved preferences from localStorage and apply them */
  loadAllPrefs();

  /* Step 2: Restore the recent cities list in the sidebar */
  renderRecentCities();

  /*
    Step 3: Optionally auto-load the last searched location.
    If the user has visited before, re-fetch weather for the
    last city they searched — so the app isn't empty on load.

    To DISABLE this behaviour, comment out the lines below.
    To DEFAULT to a specific city instead, replace the
    fetchByCoords call with: fetchByCity("London");
  */
  const last = loadPref("weather_last", null);
  if (last && last.lat && last.lon) {
    fetchByCoords(last.lat, last.lon);
  }

  /*
    Step 4: Uncomment and edit the line below to ALWAYS load
    a specific default city when the app starts fresh:
  */
  // fetchByCity("New York");

})();