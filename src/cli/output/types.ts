import type { Page, SearchItem } from '../../core/provider/provider.ts'

export type PageInfo = Pick<Page<unknown>, 'next' | 'total'>

export interface SearchOutput extends PageInfo {
  items: SearchItem[]
}
