# Meteorological Data Dictionary

## 1. Variables Catalog

| Short Name | Standard Name | Long Name | GRIB Param ID | Step Type | Raw Unit | Normalized Unit | Conversion Formula |
|---|---|---|---|---|---|---|---|
| `t2m` | `air_temperature` | 2 metre temperature | 167 | `instant` | `K` (Kelvin) | `degC` (°Celsius) | `degC = K - 273.15` |
| `d2m` | `dew_point_temperature` | 2 metre dewpoint temperature | 168 | `instant` | `K` (Kelvin) | `degC` (°Celsius) | `degC = K - 273.15` |
| `msl` | `air_pressure_at_mean_sea_level` | Mean sea level pressure | 151 | `instant` | `Pa` (Pascals) | `hPa` (Hectopascals) | `hPa = Pa / 100.0` |
| `tp` | `precipitation_amount` | Total precipitation | 228 | `accum` | `m` (meters) | `mm` (millimeters) | `mm = m * 1000.0` |

---

## 2. Derived Meteorological Variables

### Relative Humidity ($RH$ in %)
Calculated using the Magnus-Tetens approximation:
$$\gamma(T) = \frac{17.27 \times T}{237.7 + T}$$
$$\gamma(T_d) = \frac{17.27 \times T_d}{237.7 + T_d}$$
$$RH = 100 \times \exp(\gamma(T_d) - \gamma(T))$$

### Dew Point Depression ($DPD$ in °C)
$$DPD = T - T_d$$
Represents how close the air is to saturation (smaller values indicate high humidity/fog potential).

### Vapor Pressure Deficit ($VPD$ in kPa)
$$e_s = 0.61078 \times \exp\left(\frac{17.27 \times T}{T + 237.3}\right)$$
$$e_a = e_s \times \frac{RH}{100}$$
$$VPD = e_s - e_a$$

---

## 3. Discovered Spatial Districts in Karnataka

| District Folder | Spatial Grid | Total Grid Cells | Latitude Bounds | Longitude Bounds |
|---|---|---|---|---|
| `belagavi` | 8 rows x 7 cols | 56 points | 15.25°N - 17.00°N | 74.00°E - 75.50°E |
| `bengaluru_urban` | 4 rows x 4 cols | 16 points | 12.75°N - 13.50°N | 77.25°E - 78.00°E |
| `dakshina_kannada` | 2 rows x 2 cols | 4 points | 12.50°N - 12.75°N | 75.25°E - 75.50°E |
| `mysore` | 3 rows x 3 cols | 9 points | 11.75°N - 12.25°N | 76.25°E - 76.75°E |
| `udupi` | 2 rows x 3 cols | 6 points | 13.25°N - 13.50°N | 74.75°E - 75.25°E |
| **Total** | | **91 points** | | |
