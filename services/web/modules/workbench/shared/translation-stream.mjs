export function translationFrames() {
  let pending = '';
  return chunk => {
    pending += chunk;
    const frames = [];
    let boundary;
    while ((boundary = /\r?\n\r?\n/.exec(pending))) {
      const frame = pending.slice(0, boundary.index);
      pending = pending.slice(boundary.index + boundary[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) frames.push(JSON.parse(data));
    }
    return frames;
  };
}
