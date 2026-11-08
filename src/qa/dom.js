const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai',
});

export function makeElement(document, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function makeDate(document, timestamp) {
  const date = new Date(timestamp);
  const node = makeElement(document, 'time', 'qa-date', dateFormat.format(date));
  node.dateTime = timestamp;
  return node;
}

export function setMessage(element, text, tone = '') {
  element.textContent = text;
  element.dataset.tone = tone;
}

export function setCounter(input, counter, maximum) {
  const update = () => {
    const count = Array.from(input.value.trim()).length;
    setMessage(counter, `${count} / ${maximum}`, count > maximum ? 'error' : '');
    return count;
  };
  input.addEventListener('input', update);
  update();
  return update;
}
