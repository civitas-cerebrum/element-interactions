export class DateUtilities {
  /**
   * Reformats a recognizable date string into a target format.
   * Mirrors the Java DateUtilities.reformatDateString method.
   */
  static reformatDateString(rawDate: string, format: string): string {
    // Parse the raw date string into a JS Date object
    const date = new Date(rawDate);

    // Guard clause: Check if the date is valid before formatting
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date string provided: ${rawDate}`);
    }

    const yyyy = date.getFullYear().toString();
    const MM = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');

    // Unpadded variables for single-digit months/days
    const M = String(date.getMonth() + 1);
    const d = String(date.getDate());

    // You can expand this switch/if statement as your framework's formatting needs grow
    switch (format) {
      case 'yyyy-MM-dd':
        return `${yyyy}-${MM}-${dd}`;
      case 'dd-MM-yyyy':
        return `${dd}-${MM}-${yyyy}`;
      case 'dd MMM yyyy':
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${dd} ${monthNames[date.getMonth()]} ${yyyy}`;
      case 'yyyy-M-d': // 💡 New format matching the modal's output
        return `${yyyy}-${M}-${d}`;
      default:
        console.warn(`Format ${format} not fully supported, returning ISO date.`);
        return `${yyyy}-${MM}-${dd}`;
    }
  }
}