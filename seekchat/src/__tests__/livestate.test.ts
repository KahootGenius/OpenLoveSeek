import { getLiveGeoFresh, setLiveGeo } from '../lib/livestate';

const fix = (over = {}) => ({ lat: 31.23, lng: 121.47, city: '上海', ageMs: 60000, ...over });

describe('getLiveGeoFresh', () => {
  it('returns a just-cached fresh fix', () => {
    setLiveGeo(fix());
    expect(getLiveGeoFresh()?.city).toBe('上海');
  });
  it('drops a fix whose native age already exceeds the window', () => {
    setLiveGeo(fix({ ageMs: 7 * 3600000 })); // read just now, but was 7h old at read time
    expect(getLiveGeoFresh()).toBeNull();
  });
  it('returns null when nothing is cached', () => {
    setLiveGeo(null);
    expect(getLiveGeoFresh()).toBeNull();
  });
});
