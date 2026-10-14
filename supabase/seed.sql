-- Synthetische Beispielnachrichten (keine echten Patientendaten).
-- Nach schema.sql im SQL Editor ausführen. Erneutes Ausführen ersetzt die Beispiele.
delete from public.messages where shared and owner_id is null;

insert into public.messages (owner_id, title, shared, hl7) values (null, 'Beispiel: Urinkultur, 2 Erreger (Kind-OBR)', true,
  replace($hl7$MSH|^~\&|LIS_MIBI|LABOR|IMEDONE|KLINIKUM|20261012143000||ORU^R01^ORU_R01|MSG000123|P|2.5|||AL|NE||8859/1
PID|1||4711001^^^KLINIKUM^PI||Mustermann^Max^^^^^L||19650412|M
PV1|1|I|STA3^301^1^KLINIKUM||||1234^Arzt^Anna^^^Dr.||||||||||||90001234
ORC|RE|A123456|M2610120045||CM
OBR|1|A123456|M2610120045|URIKU^Urinkultur^L|||20261010080000|||||||20261010093000|URIN^Mittelstrahlurin^HL70487|1234^Arzt^Anna^^^Dr.||||||20261012142500|||F
OBX|1|ST|MIKRO^Mikroskopie^L||Leukozyten massenhaft, Bakterien reichlich||||||F
OBX|2|CWE|11475-1^Erreger^LN|1|ECOL^Escherichia coli^L||||||F
OBX|3|ST|564-5^Keimzahl^LN|1|>10\S\5|KBE/ml|||||F
OBX|4|CWE|11475-1^Erreger^LN|2|EFAE^Enterococcus faecalis^L||||||F
OBX|5|ST|564-5^Keimzahl^LN|2|10\S\4|KBE/ml|||||F
NTE|1|L|Mischkultur, Kontamination nicht auszuschließen.
OBR|2|A123456|M2610120045-1|ABG^Antibiogramm^L|||20261010080000||||||||URIN^Mittelstrahlurin^HL70487|||||||20261012142500|||F|11475-1&Erreger&LN^1|||A123456&M2610120045
OBX|1|SN|AMP^Ampicillin^L||>^8|mg/l||R|||F
OBX|2|SN|AMS^Ampicillin/Sulbactam^L||^4|mg/l||S|||F
OBX|3|SN|PIT^Piperacillin/Tazobactam^L||<=^4|mg/l||S|||F
OBX|4|SN|CXM^Cefuroxim^L||^8|mg/l||I|||F
OBX|5|SN|CTX^Cefotaxim^L||<=^1|mg/l||S|||F
OBX|6|SN|CIP^Ciprofloxacin^L||>^1|mg/l||R|||F
OBX|7|SN|SXT^Cotrimoxazol^L||<=^20|mg/l||S|||F
OBX|8|SN|FOS^Fosfomycin^L||<=^16|mg/l||S|||F
OBX|9|SN|NIT^Nitrofurantoin^L||<=^16|mg/l||S|||F
OBX|10|SN|MEM^Meropenem^L||<=^0.25|mg/l||S|||F
OBR|3|A123456|M2610120045-2|ABG^Antibiogramm^L|||20261010080000||||||||URIN^Mittelstrahlurin^HL70487|||||||20261012142500|||F|11475-1&Erreger&LN^2|||A123456&M2610120045
OBX|1|SN|AMP^Ampicillin^L||<=^2|mg/l||S|||F
OBX|2|SN|VAN^Vancomycin^L||^1|mg/l||S|||F
OBX|3|SN|NIT^Nitrofurantoin^L||<=^32|mg/l||S|||F
OBX|4|SN|LZD^Linezolid^L||^2|mg/l||S|||F
NTE|1|L|Endbefund. Bei Rückfragen: Labor Mikrobiologie, Tel. 1234.$hl7$, E'\n', E'\r'));

insert into public.messages (owner_id, title, shared, hl7) values (null, 'Beispiel: Blutkultur MRSA, vorläufig (OBX Sub-ID)', true,
  replace($hl7$MSH|^~\&|LIS_MIBI|LABOR|IMEDONE|KLINIKUM|20261013091500||ORU^R01|MSG000124|P|2.3
PID|1||4711002^^^KLINIKUM^PI||Musterfrau^Erika||19781103|F
PV1|1|I|ITS1^12^2^KLINIKUM||||||||||||||||90004567
OBR|1|B998877|M2610130012|BK^Blutkultur aerob/anaerob^L|||20261011220000|||||||20261011230000|BLUT^Blutkultur^HL70070|||||||20261013091000|||P
OBX|1|ST|GRAM^Gramfärbung^L|1|Grampositive Haufenkokken||||||P
OBX|2|CWE|ORG^Erreger^L|1|SAUR^Staphylococcus aureus^L||||||P
OBX|3|NM|OXA^Oxacillin^L|1|>2|mg/l||R|||P
OBX|4|NM|VAN^Vancomycin^L|1|1|mg/l||S|||P
OBX|5|NM|CLI^Clindamycin^L|1|0.25|mg/l||S|||P
OBX|6|NM|SXT^Cotrimoxazol^L|1|10|mg/l||S|||P
OBX|7|NM|LZD^Linezolid^L|1|2|mg/l||S|||P
NTE|1|L|MRSA! Bitte Hygienefachpersonal informieren.\.br\Vorläufiger Befund, Endbefund folgt.$hl7$, E'\n', E'\r'));
