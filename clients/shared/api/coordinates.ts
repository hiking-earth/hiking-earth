/** WGS84 存储与运算；仅地图渲染使用 GCJ-02。 */
export function toMapPoint(p: { latitude: number; longitude: number }) {
  const { latitude: lat, longitude: lng } = p;
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return { latitude: lat, longitude: lng };
  const pi = Math.PI, x = lng - 105, y = lat - 35;
  let dLat = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  dLat += (20*Math.sin(6*x*pi) + 20*Math.sin(2*x*pi))*2/3;
  dLat += (20*Math.sin(y*pi) + 40*Math.sin(y*pi/3))*2/3;
  dLat += (160*Math.sin(y*pi/12) + 320*Math.sin(y*pi/30))*2/3;
  let dLng = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  dLng += (20*Math.sin(6*x*pi) + 20*Math.sin(2*x*pi))*2/3;
  dLng += (20*Math.sin(x*pi) + 40*Math.sin(x*pi/3))*2/3;
  dLng += (150*Math.sin(x*pi/12) + 300*Math.sin(x*pi/30))*2/3;
  const rad = lat*pi/180, sin = Math.sin(rad);
  const magic = 1 - 0.00669342162296594323*sin*sin, root = Math.sqrt(magic), a = 6378245;
  return { latitude: lat + dLat*180/((a*(1-0.00669342162296594323))/(magic*root)*pi), longitude: lng+dLng*180/(a/root*Math.cos(rad)*pi) };
}
