from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from pypdf import PdfReader, PdfWriter
from PIL import Image, ImageDraw, ImageFont
# Test fixtures only. Requires reportlab, pypdf and Pillow; no app runtime dependency.
out = Path(__file__).resolve().parent.parent / 'tests/fixtures/pdf'
out.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(out/'diagram.pdf'), pagesize=(600,800))
c.setTitle('Flow of water')
c.setFont('Helvetica',20); c.drawString(50,740,'Flow of water')
c.setFont('Helvetica',12); c.drawString(50,700,'Water moves from reservoir A to tank B through a pump.')
c.drawString(50,680,'The arrow points from A to B, not from B to A.')
c.setFillColorRGB(.85,.92,1); c.rect(65,400,150,120,fill=1); c.rect(385,400,150,120,fill=1)
c.setFillColorRGB(0,0,0); c.drawString(85,455,'Reservoir A'); c.drawString(405,455,'Tank B')
c.setLineWidth(4); c.line(225,460,375,460); c.line(375,460,360,470);c.line(375,460,360,450)
c.drawString(270,485,'pump'); c.showPage()
c.setFont('Helvetica',16);c.drawString(50,740,'Checking the pump')
c.setFont('Helvetica',12);c.drawString(50,700,'If the pump stops, water transfer stops.');c.save()
c = canvas.Canvas(str(out/'long.pdf'), pagesize=(600,800))
for n in range(30):
 c.setFont('Helvetica',16);c.drawString(50,750,f'Chapter {n+1}')
 c.setFont('Helvetica',11)
 for line in range(36): c.drawString(50,720-line*18,f'Page {n+1}: Learning with retrieval and careful review. Line {line+1}.')
 c.showPage()
c.save()
im=Image.new('RGB',(1200,1600),'white');d=ImageDraw.Draw(im)
f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',48)
d.text((80,160),'SCANNED WATER CYCLE',font=f,fill='black'); d.text((80,260),'Heat turns water into vapor.',font=f,fill='black')
korean=ImageFont.truetype('/System/Library/Fonts/AppleSDGothicNeo.ttc',48)
d.text((80,350),'물은 열을 받아 수증기로 변합니다.',font=korean,fill='black')
d.rectangle((100,500,420,750),outline='blue',width=6);d.rectangle((780,500,1100,750),outline='blue',width=6)
d.text((150,590),'Water',font=f,fill='black');d.text((820,590),'Vapor',font=f,fill='black');d.line((440,620,760,620),fill='black',width=8);d.line((760,620,735,600),fill='black',width=8);d.line((760,620,735,640),fill='black',width=8)
c=canvas.Canvas(str(out/'scan.pdf'),pagesize=(600,800));c.drawImage(ImageReader(im),0,0,600,800);c.save()
w=PdfWriter();w.append(str(out/'diagram.pdf'));w.encrypt('test-password');w.write(str(out/'encrypted.pdf'))
w=PdfWriter();w.append(str(out/'diagram.pdf'));w.encrypt(user_password='',owner_password='fixture-owner-password',algorithm='AES-128');w.write(str(out/'owner-encrypted.pdf'))
w=PdfWriter();page=PdfReader(str(out/'diagram.pdf')).pages[0];page.rotate(90);w.add_page(page);w.write(str(out/'rotated.pdf'))
w=PdfWriter();w.add_blank_page(width=600,height=800);w.write(str(out/'blank.pdf'))
c=canvas.Canvas(str(out/'too-many-pages.pdf'),pagesize=(100,100))
for _ in range(301): c.drawString(5,50,'page');c.showPage()
c.save()
