/**
 * Reformats a recognizable date string into a target format.
 * Mirrors the Java DateUtilities.reformatDateString method.
 * @param rawDate - The input date string to parse (must be parseable by `new Date()`).
 * @param format - The target format string. Supported: 'yyyy-MM-dd', 'dd-MM-yyyy', 'dd MMM yyyy', 'yyyy-M-d'.
 * @returns The reformatted date string.
 * @throws Error if the date string cannot be parsed.
 */
export function reformatDateString(rawDate: string, format: string): string {
    const date = new Date(rawDate);

    if (isNaN(date.getTime())) {
        throw new Error(`Invalid date string provided: ${rawDate}`);
    }

    const yyyy = date.getFullYear().toString();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const M = String(date.getMonth() + 1);
    const d = String(date.getDate());

    switch (format) {
        case 'yyyy-MM-dd':
            return `${yyyy}-${MM}-${dd}`;
        case 'dd-MM-yyyy':
            return `${dd}-${MM}-${yyyy}`;
        case 'dd MMM yyyy': {
            const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return `${dd} ${monthNames[date.getMonth()]} ${yyyy}`;
        }
        case 'yyyy-M-d':
            return `${yyyy}-${M}-${d}`;
        default:
            console.warn(`Format ${format} not fully supported, returning ISO date.`);
            return `${yyyy}-${MM}-${dd}`;
    }
}
