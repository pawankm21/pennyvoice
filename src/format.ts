const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })
export const money = (paise: number) => formatter.format(paise / 100)
