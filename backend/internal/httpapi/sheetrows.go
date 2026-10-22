// Sheet rows for the serial print (F46): an .xlsx file as rows of cells, each
// cell as Excel shows it, so a column of batch numbers, expiry dates or PZNs
// arrives the way it reads in the spreadsheet: dates in their date format
// (not as day numbers), numbers formatted with leading zeros kept ("0000000"),
// text as is. Nothing is stored. The shared-string, sheet-order and zip
// helpers are the ones the AI document extraction uses (extractfile.go).
package httpapi

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"math"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"hycanvas/backend/internal/accounts"
)

// Bounds of one read: enough for a label run, small enough for the browser.
const (
	maxSheetRows = 10000
	maxSheetCols = 200
)

// SheetData is one worksheet: its name and its rows of cells.
type SheetData struct {
	Name string     `json:"name"`
	Rows [][]string `json:"rows"`
}

func mountSheetRows(api chi.Router, acct *accounts.Service) {
	api.With(requireAuth(acct)).Post("/data/sheet-rows", sheetRowsHandler())
}

func sheetRowsHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, (maxOfficeFileBytes/3)*4+4096)
		var body struct {
			Filename   string `json:"filename"`
			DataBase64 string `json:"dataBase64"`
			// The reader's language, for dates in Excel's own short date format.
			Locale string `json:"locale"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				problemWithCode(w, r, http.StatusRequestEntityTooLarge, "Payload Too Large", "the file exceeds the 20 MiB limit", "sheet_too_large")
				return
			}
			problemWithCode(w, r, http.StatusBadRequest, "Bad Request", "invalid body", "invalid_body")
			return
		}
		data, err := base64.StdEncoding.DecodeString(body.DataBase64)
		if strings.ToLower(path.Ext(body.Filename)) != ".xlsx" || err != nil || len(data) < 4 || data[0] != 'P' || data[1] != 'K' {
			problemWithCode(w, r, http.StatusUnsupportedMediaType, "Unsupported Media Type", "only .xlsx files can be read", "sheet_unsupported")
			return
		}
		if len(data) > maxOfficeFileBytes {
			problemWithCode(w, r, http.StatusRequestEntityTooLarge, "Payload Too Large", "the file exceeds the 20 MiB limit", "sheet_too_large")
			return
		}
		sheets, err := readXlsxSheets(data, body.Locale)
		if err != nil {
			problemWithCode(w, r, http.StatusUnprocessableEntity, "Unprocessable Entity", "the spreadsheet could not be read", "sheet_unreadable")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"sheets": sheets})
	}
}

// readXlsxSheets reads every worksheet of an .xlsx file in display order.
func readXlsxSheets(data []byte, locale string) ([]SheetData, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	order := xlsxSheetOrder(zr)
	if len(order) == 0 {
		return nil, fmt.Errorf("no sheets")
	}
	f := cellFormatter{shared: xlsxSharedStrings(zr), formats: xlsxCellFormats(zr), date1904: xlsxDate1904(zr), locale: locale}
	out := []SheetData{}
	for _, sh := range order {
		out = append(out, SheetData{Name: sh.name, Rows: f.rows(zipEntry(zr, sh.path))})
	}
	return out, nil
}

// cellFormatter turns raw cell values into what Excel displays.
type cellFormatter struct {
	shared   []string
	formats  []string // per style index (the c element's s attribute): the number format code
	date1904 bool
	locale   string
}

// rows walks a worksheet into rows of cells at their referenced columns.
// Empty rows in between are kept, so row numbers match the spreadsheet;
// trailing empty cells and rows are dropped.
func (f cellFormatter) rows(sheet []byte) [][]string {
	if sheet == nil {
		return [][]string{}
	}
	dec := xml.NewDecoder(bytes.NewReader(sheet))
	out := [][]string{}
	var row []string
	rowIndex := -1
	inRow := false
	var (
		inCell, inV   bool
		col, nextCol  int
		cellType      string
		style         int
		val           strings.Builder
		haveRowNumber bool
	)
	setCell := func(c int, v string) {
		if c < 0 || c >= maxSheetCols {
			return
		}
		for len(row) <= c {
			row = append(row, "")
		}
		row[c] = v
	}
	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				inRow = true
				row = nil
				nextCol = 0
				haveRowNumber = false
				for _, a := range t.Attr {
					if a.Name.Local == "r" {
						if n, err := strconv.Atoi(a.Value); err == nil && n >= 1 {
							rowIndex = n - 1
							haveRowNumber = true
						}
					}
				}
				if !haveRowNumber {
					rowIndex++
				}
			case "c":
				inCell = true
				cellType = ""
				style = -1
				val.Reset()
				col = nextCol
				for _, a := range t.Attr {
					switch a.Name.Local {
					case "t":
						cellType = a.Value
					case "s":
						if n, err := strconv.Atoi(a.Value); err == nil {
							style = n
						}
					case "r":
						if c := colIndexFromRef(a.Value); c >= 0 {
							col = c
						}
					}
				}
			case "v", "t":
				if inCell {
					inV = true
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "c":
				if inCell {
					setCell(col, f.display(val.String(), cellType, style))
					nextCol = col + 1
					inCell = false
				}
			case "v", "t":
				inV = false
			case "row":
				if inRow && rowIndex < maxSheetRows {
					for len(out) < rowIndex {
						out = append(out, []string{})
					}
					for len(row) > 0 && strings.TrimSpace(row[len(row)-1]) == "" {
						row = row[:len(row)-1]
					}
					if row == nil {
						row = []string{}
					}
					if rowIndex == len(out) {
						out = append(out, row)
					}
				}
				inRow = false
			}
		case xml.CharData:
			if inCell && inV {
				val.Write(t)
			}
		}
	}
	for len(out) > 0 && len(out[len(out)-1]) == 0 {
		out = out[:len(out)-1]
	}
	return out
}

// display is a cell's value as Excel shows it.
func (f cellFormatter) display(raw, cellType string, style int) string {
	switch cellType {
	case "s":
		if i, err := strconv.Atoi(strings.TrimSpace(raw)); err == nil && i >= 0 && i < len(f.shared) {
			return f.shared[i]
		}
		return ""
	case "inlineStr", "str", "e":
		return raw
	case "b":
		if raw == "1" {
			return "TRUE"
		}
		return "FALSE"
	}
	code := ""
	if style >= 0 && style < len(f.formats) {
		code = f.formats[style]
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || code == "" {
		return raw
	}
	if isDateFormat(code) {
		return f.formatDate(n, code)
	}
	// "00000000" and the like: integers padded with leading zeros (PZNs).
	if z := strings.Trim(code, "0"); z == "" && n == math.Trunc(n) && n >= 0 {
		return fmt.Sprintf("%0*d", len(code), int64(n))
	}
	return raw
}

// builtinFormats are the number formats Excel does not write into the file.
var builtinFormats = map[int]string{
	14: "short-date", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 22: "short-date h:mm",
	45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0",
}

// isDateFormat: the code shows a date (y, m or d outside quotes and
// brackets; elapsed times and plain numbers are not dates).
func isDateFormat(code string) bool {
	if strings.HasPrefix(code, "short-date") {
		return true
	}
	inQuote, inBracket := false, false
	for _, c := range strings.ToLower(code) {
		switch {
		case c == '"':
			inQuote = !inQuote
		case inQuote:
		case c == '[':
			inBracket = true
		case c == ']':
			inBracket = false
		case inBracket:
		case c == 'y' || c == 'd':
			return true
		case c == 'm' && strings.ContainsAny(strings.ToLower(code), "yd"):
			return true
		}
	}
	return false
}

// formatDate writes an Excel day number in the code's day, month and year
// tokens (dd, d, mm, m, yyyy, yy); Excel's own short date follows the
// reader's language.
func (f cellFormatter) formatDate(serial float64, code string) string {
	base := time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)
	if f.date1904 {
		base = time.Date(1904, 1, 1, 0, 0, 0, 0, time.UTC)
	}
	day := base.AddDate(0, 0, int(math.Floor(serial)))
	if strings.HasPrefix(code, "short-date") {
		switch {
		case strings.HasPrefix(f.locale, "de"):
			code = "dd.mm.yyyy"
		case strings.HasPrefix(f.locale, "en-us"), f.locale == "en":
			code = "m/d/yyyy"
		default:
			code = "yyyy-mm-dd"
		}
	}
	var b strings.Builder
	lc := strings.ToLower(code)
	for i := 0; i < len(lc); {
		run := func(c byte) int {
			j := i
			for j < len(lc) && lc[j] == c {
				j++
			}
			return j - i
		}
		switch c := lc[i]; c {
		case 'y':
			n := run('y')
			if n <= 2 {
				fmt.Fprintf(&b, "%02d", day.Year()%100)
			} else {
				fmt.Fprintf(&b, "%04d", day.Year())
			}
			i += n
		case 'm':
			n := run('m')
			if n >= 2 {
				fmt.Fprintf(&b, "%02d", int(day.Month()))
			} else {
				fmt.Fprintf(&b, "%d", int(day.Month()))
			}
			i += n
		case 'd':
			n := run('d')
			if n >= 2 {
				fmt.Fprintf(&b, "%02d", day.Day())
			} else {
				fmt.Fprintf(&b, "%d", day.Day())
			}
			i += n
		case '"', '\\', '[', ']', ';', '@':
			// Quotes, escapes and sections: the quoted text stays, markup goes.
			if c == '"' {
				j := strings.IndexByte(lc[i+1:], '"')
				if j < 0 {
					i = len(lc)
					break
				}
				b.WriteString(code[i+1 : i+1+j])
				i += j + 2
				break
			}
			if c == ';' {
				i = len(lc)
				break
			}
			i++
		default:
			b.WriteByte(code[i])
			i++
		}
	}
	return b.String()
}

// xlsxCellFormats maps each style index to its number format code.
func xlsxCellFormats(zr *zip.Reader) []string {
	b := zipEntry(zr, "xl/styles.xml")
	if b == nil {
		return nil
	}
	var doc struct {
		NumFmts []struct {
			ID   int    `xml:"numFmtId,attr"`
			Code string `xml:"formatCode,attr"`
		} `xml:"numFmts>numFmt"`
		Xfs []struct {
			NumFmtID int `xml:"numFmtId,attr"`
		} `xml:"cellXfs>xf"`
	}
	if err := xml.Unmarshal(b, &doc); err != nil {
		return nil
	}
	custom := map[int]string{}
	for _, n := range doc.NumFmts {
		custom[n.ID] = n.Code
	}
	out := make([]string, len(doc.Xfs))
	for i, x := range doc.Xfs {
		if c, ok := custom[x.NumFmtID]; ok {
			out[i] = c
		} else {
			out[i] = builtinFormats[x.NumFmtID]
		}
	}
	return out
}

// xlsxDate1904 reports the workbook's 1904 date system (old Mac files).
func xlsxDate1904(zr *zip.Reader) bool {
	b := zipEntry(zr, "xl/workbook.xml")
	return bytes.Contains(b, []byte(`date1904="1"`)) || bytes.Contains(b, []byte(`date1904="true"`))
}
