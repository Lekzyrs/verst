// Общий договор со страницей: классы, которые элементам Zero Block ставят в редакторе Tilda (поле classname),
// и CSS-переменные, через которые свет лампы попадает в CSS страницы.

export const SEL = { stage: '.vs-stage', poster: '.vs-poster', label: '.vs-label', pull: '.vs-pull', state: '.vs-state' } as const;
export const VARS = { lit: '--vs-lit', lightX: '--vs-lx', lightY: '--vs-ly' } as const;
export const CANVAS_ID = 'vs-canvas';

/** Узел с текстом внутри элемента Tilda: подпись кнопки, иначе .tn-atom; если внутри нет ни того ни другого, сам элемент. */
export function atom(el: Element): HTMLElement {
  return el.querySelector<HTMLElement>('.tn-atom__button-text') ?? el.querySelector<HTMLElement>('.tn-atom') ?? (el as HTMLElement);
}
