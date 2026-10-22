package httpapi

import (
	"archive/zip"
	"bytes"
	"reflect"
	"testing"
)

// xlsxOf builds a minimal workbook: one sheet with the given XML rows, a
// style table and shared strings.
func xlsxOf(t *testing.T, rows string, date1904 bool) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	put := func(name, body string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(body))
	}
	wbPr := ""
	if date1904 {
		wbPr = `<workbookPr date1904="1"/>`
	}
	put("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`+wbPr+`<sheets><sheet name="Etiketten" sheetId="1" r:id="rId1"/></sheets></workbook>`)
	put("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)
	// Styles: 0 general, 1 builtin short date (14), 2 custom "mm.yyyy", 3 "00000000".
	put("xl/styles.xml", `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="mm.yyyy"/><numFmt numFmtId="165" formatCode="00000000"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>`)
	put("xl/sharedStrings.xml", `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Name</t></si><si><t>Verfall</t></si><si><t>PZN</t></si><si><t>Müller &amp; Söhne</t></si><si><r><t>Char</t></r><r><t>ge</t></r></si></sst>`)
	put("xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`+rows+`</sheetData></worksheet>`)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestReadXlsxSheets(t *testing.T) {
	// 46022 is 2025-12-31 in the 1900 date system.
	rows := `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>4</v></c><c r="E1" t="s"><v>1</v></c></row>` +
		`<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" s="2"><v>46022</v></c><c r="C2" s="3"><v>4711146</v></c><c r="D2" t="inlineStr"><is><t>CH-0815</t></is></c><c r="E2" s="1"><v>46022</v></c></row>` +
		// Row 3 left empty; row 4 has a cell in column C only.
		`<row r="4"><c r="C4" s="0"><v>3.5</v></c></row>`
	sheets, err := readXlsxSheets(xlsxOf(t, rows, false), "de-DE")
	if err != nil {
		t.Fatal(err)
	}
	if len(sheets) != 1 || sheets[0].Name != "Etiketten" {
		t.Fatalf("sheets: %+v", sheets)
	}
	want := [][]string{
		{"Name", "Verfall", "PZN", "Charge", "Verfall"},
		{"Müller & Söhne", "12.2025", "04711146", "CH-0815", "31.12.2025"},
		{},
		{"", "", "3.5"},
	}
	if !reflect.DeepEqual(sheets[0].Rows, want) {
		t.Fatalf("rows:\n got %q\nwant %q", sheets[0].Rows, want)
	}
	// Excel's own short date follows the reader's language.
	en, _ := readXlsxSheets(xlsxOf(t, rows, false), "en-us")
	if got := en[0].Rows[1][4]; got != "12/31/2025" {
		t.Fatalf("en short date: %q", got)
	}
	other, _ := readXlsxSheets(xlsxOf(t, rows, false), "fr")
	if got := other[0].Rows[1][4]; got != "2025-12-31" {
		t.Fatalf("iso short date: %q", got)
	}
	// The 1904 date system counts from 1904-01-01.
	mac, _ := readXlsxSheets(xlsxOf(t, `<row r="1"><c r="A1" s="1"><v>0</v></c></row>`, true), "de")
	if got := mac[0].Rows[0][0]; got != "01.01.1904" {
		t.Fatalf("1904: %q", got)
	}
}

func TestIsDateFormat(t *testing.T) {
	for code, want := range map[string]bool{
		"dd.mm.yyyy": true, "mm.yyyy": true, "yyyy-mm-dd": true, "short-date": true,
		"00000000": false, "0.00": false, "#,##0": false, `"Charge "0`: false, "[h]:mm:ss": false, "mm:ss": false,
	} {
		if got := isDateFormat(code); got != want {
			t.Errorf("%q: got %v want %v", code, got, want)
		}
	}
}
