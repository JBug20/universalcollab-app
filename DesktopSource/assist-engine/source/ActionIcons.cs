using System;using System.Drawing;using System.Drawing.Drawing2D;using System.Collections.Generic;
public static class ActionIcons {
 static readonly Dictionary<string,Bitmap> cache=new Dictionary<string,Bitmap>();
 static string Category(string kind){switch(kind){case "Follow":return "heart";case "GiftSub":case "GiftBomb":case "GiftSubscription":case "MassGiftSubscription":case "MembershipGift":case "GiftMembershipReceived":return "gift";case "Cheer":case "KicksGifted":case "JewelsGifted":return "gem";case "Donation":case "Tip":case "CharityDonation":case "SuperChat":case "SuperSticker":return "coin";case "Raid":return "raid";default:return "star";}}
 public static Bitmap Get(string kind){string key=Category(kind);Bitmap image;if(cache.TryGetValue(key,out image))return image;image=new Bitmap(48,48);using(var g=Graphics.FromImage(image)){g.SmoothingMode=SmoothingMode.AntiAlias;using(var background=new SolidBrush(Theme.Raised))g.FillEllipse(background,0,0,47,47);using(var ink=new SolidBrush(Theme.Accent))using(var pen=new Pen(Theme.Accent,2.8f)){pen.StartCap=pen.EndCap=LineCap.Round;
 if(key=="heart"){using(var heart=new GraphicsPath()){heart.AddBezier(24,16,12,3,2,23,24,37);heart.AddBezier(24,37,46,23,36,3,24,16);g.FillPath(ink,heart);}}
 else if(key=="gift"){g.DrawRectangle(pen,11,21,26,16);g.DrawRectangle(pen,9,16,30,6);g.DrawLine(pen,24,17,24,37);g.DrawEllipse(pen,15,9,9,8);g.DrawEllipse(pen,24,9,9,8);}
 else if(key=="gem"){g.DrawPolygon(pen,new[]{new Point(15,12),new Point(33,12),new Point(40,22),new Point(24,38),new Point(8,22)});g.DrawLine(pen,8,22,40,22);g.DrawLine(pen,18,22,24,38);g.DrawLine(pen,30,22,24,38);}
 else if(key=="coin"){g.DrawEllipse(pen,9,9,30,30);g.DrawArc(pen,17,14,15,10,75,270);g.DrawArc(pen,16,24,15,10,255,270);g.DrawLine(pen,24,11,24,37);}
 else if(key=="raid"){g.DrawLine(pen,10,24,37,24);g.DrawLine(pen,28,14,38,24);g.DrawLine(pen,38,24,28,34);g.DrawLine(pen,10,15,17,15);g.DrawLine(pen,10,33,17,33);}
 else{var points=new PointF[10];for(int i=0;i<10;i++){double angle=-Math.PI/2+i*Math.PI/5;double r=i%2==0?17:8;points[i]=new PointF((float)(24+Math.Cos(angle)*r),(float)(24+Math.Sin(angle)*r));}g.FillPolygon(ink,points);}
 }}cache[key]=image;return image;}
}
