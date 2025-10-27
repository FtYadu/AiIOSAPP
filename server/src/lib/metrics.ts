type MetricRecord = {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: number;
};

const buffer: MetricRecord[] = [];

export const metrics = {
  record(name: string, value: number, tags?: Record<string, string>): void {
    buffer.push({ name, value, tags, timestamp: Date.now() });
    if (buffer.length > 1000) {
      buffer.shift();
    }
  },
  flush(): MetricRecord[] {
    const copy = [...buffer];
    buffer.length = 0;
    return copy;
  }
};
