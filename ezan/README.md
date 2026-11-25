# Ezan Vakitleri

Diyanet namaz vakitlerinde ezanı bir `media_player`'a (Nest Hub, Sonos, …) veya Raspberry Pi'nin
kendi ses çıkışına çalar.

- Vakitler her gün Diyanet'ten çekilir ve önbelleğe alınır; internet yokken de çalışır.
- Sabah ezanı güneş − 40 dk'da okunur (ayarlanabilir). İmsak ezanı ayrıca açılabilir.
- Vakitler MQTT ile sensör olarak açılır: `sensor.ezan_imsak` … `sensor.ezan_yatsi`, `sensor.ezan_sonraki_vakit`.
- `switch.ezan_sustur` ve vakit bazında susturma switch'leri vardır.

Kurulum ve ayarlar için **Dokümantasyon** sekmesine bakın.
