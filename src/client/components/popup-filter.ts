/** popupSelect 本地过滤：与官方 filterOptions 同语义（label/detail 大小写不敏感子串）。 */

import type { SelectOption } from '../host-types';

export function filterOptions(options: readonly SelectOption[], search: string): readonly SelectOption[] {
  const q = search.trim().toLowerCase();
  if (q === '') return options;
  return options.filter((option) => {
    const label = typeof option.label === 'string' ? option.label.toLowerCase() : '';
    const detail = typeof option.detail === 'string' ? option.detail.toLowerCase() : '';
    return label.includes(q) || detail.includes(q);
  });
}
