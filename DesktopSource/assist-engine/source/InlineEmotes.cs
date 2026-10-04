using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

public static class EmoteNetwork {
 public static void Configure(){System.Net.ServicePointManager.SecurityProtocol=System.Net.SecurityProtocolType.Tls12;}
 public static string Error(Exception ex){if(ex is TaskCanceledException)return "request timed out";string message=ex.GetBaseException().Message.Replace("\r"," ").Replace("\n"," ");return message.Length>220?message.Substring(0,220):message;}
}

public sealed class SevenTvCatalog : IDisposable {
 readonly Dictionary<string,Emote> extraEmotes=new Dictionary<string,Emote>(StringComparer.Ordinal);string extrasChannel="";DateTime extrasAt=DateTime.MinValue;
 async Task<object> ExtraRead(string url){using(var r=await http.GetAsync(url)){if(r.StatusCode==System.Net.HttpStatusCode.NotFound)return null;r.EnsureSuccessStatusCode();return new System.Web.Script.Serialization.JavaScriptSerializer{MaxJsonLength=4194304}.DeserializeObject(await r.Content.ReadAsStringAsync());}}
 public static Dictionary<string,Emote> ParseBttv(object data){var result=new Dictionary<string,Emote>(StringComparer.Ordinal);var list=Protocol.Items(data)??(Protocol.Items(Protocol.Get(data,"channelEmotes"))??new object[0]).Concat(Protocol.Items(Protocol.Get(data,"sharedEmotes"))??new object[0]).ToArray();foreach(var e in list.Take(3000)){string id=Protocol.Pick(e,"id"),name=Protocol.Pick(e,"code");if(name.Length<1||name.Length>100||!Regex.IsMatch(id,"^[a-f0-9]{24}$")||Protocol.Pick(e,"modifier").Equals("true",StringComparison.OrdinalIgnoreCase))continue;result[name]=new Emote{Name=name,Url="https://cdn.betterttv.net/emote/"+id+"/2x"};}return result;}
 public static Dictionary<string,Emote> ParseFfz(object data){var result=new Dictionary<string,Emote>(StringComparer.Ordinal);var sets=Protocol.Get(data,"sets") as Dictionary<string,object>;if(sets==null)return result;var defaults=Protocol.Items(Protocol.Get(data,"default_sets"));foreach(var pair in sets){if(defaults!=null&&!defaults.Any(x=>x.ToString()==pair.Key))continue;foreach(var e in (Protocol.Items(Protocol.Get(pair.Value,"emoticons"))??new object[0]).Take(3000)){string name=Protocol.Pick(e,"name"),url=Protocol.Pick(e,"animated.2","urls.2","urls.1");if(url.StartsWith("//"))url="https:"+url;if(name.Length>0&&name.Length<=100&&EmoteCache.Allowed(url)&&new Uri(url).Host=="cdn.frankerfacez.com")result[name]=new Emote{Name=name,Url=url};}}return result;}
 async Task RefreshExtras(string platform,string channelId){if(platform!="twitch")return;if(extrasChannel==channelId&&(DateTime.UtcNow-extrasAt).TotalMinutes<5)return;if(extrasChannel!=channelId)extraEmotes.Clear();extrasChannel=channelId;var next=new Dictionary<string,Emote>(StringComparer.Ordinal);bool success=true;var urls=new List<string>{"https://api.frankerfacez.com/v1/set/global","https://api.betterttv.net/3/cached/emotes/global"};if(Regex.IsMatch(channelId??"","^[0-9]+$")){urls.Add("https://api.frankerfacez.com/v1/room/id/"+channelId);urls.Add("https://api.betterttv.net/3/cached/users/twitch/"+channelId);}foreach(var url in urls)try{var data=await ExtraRead(url);foreach(var entry in url.Contains("betterttv")?ParseBttv(data):ParseFfz(data))next[entry.Key]=entry.Value;}catch{success=false;}if(disposed)return;foreach(var item in next)extraEmotes[item.Key]=item.Value;if(success){extraEmotes.Clear();foreach(var item in next)extraEmotes[item.Key]=item.Value;}extrasAt=DateTime.UtcNow;}

 readonly HttpClient http=new HttpClient(new HttpClientHandler{AllowAutoRedirect=false,UseCookies=false}){Timeout=TimeSpan.FromSeconds(12),MaxResponseContentBufferSize=4194304};
 Dictionary<string,Emote> globals=new Dictionary<string,Emote>(StringComparer.Ordinal),channel=new Dictionary<string,Emote>(StringComparer.Ordinal);
 readonly Dictionary<string,Emote> twitch=new Dictionary<string,Emote>(StringComparer.Ordinal);
 public string Status="Connect to Streamer.bot to detect your Twitch channel.";
 public string Platform="twitch",ChannelId="",SetOverride="";
 bool disposed,busy;
 public Emote Find(string name,string platform){Emote value;if(platform.Equals("Twitch",StringComparison.OrdinalIgnoreCase)&&twitch.TryGetValue(name,out value))return value;if(!platform.Equals(Platform,StringComparison.OrdinalIgnoreCase))return null;return channel.TryGetValue(name,out value)||globals.TryGetValue(name,out value)||(platform.Equals("Twitch",StringComparison.OrdinalIgnoreCase)&&extraEmotes.TryGetValue(name,out value))?value:null;}
 public string TwitchStatus="Twitch emotes: connect to Streamer.bot to load.";
 public int TwitchCount{get{return twitch.Count;}}
 public bool LearnTwitch(IEnumerable<Emote> emotes){bool changed=false;foreach(var emote in emotes){Uri uri;if(string.IsNullOrEmpty(emote.Name)||!EmoteCache.Allowed(emote.Url)||!Uri.TryCreate(emote.Url,UriKind.Absolute,out uri)||uri.Host!="static-cdn.jtvnw.net")continue;Emote old;if(twitch.TryGetValue(emote.Name,out old)&&old.Url==emote.Url)continue;if(twitch.Count>=5000&&!twitch.ContainsKey(emote.Name))continue;twitch[emote.Name]=emote;changed=true;}if(changed)TwitchStatus="Twitch ready · "+twitch.Count+" emotes · learns from incoming messages";return changed;}
 public void ImportTwitch(object response){if(Protocol.Pick(response,"status")=="error"){TwitchStatus="Twitch list unavailable. Emotes can still load from incoming messages.";return;}var entries=Protocol.Items(Protocol.Get(response,"emotes.userEmotes"));if(entries==null){TwitchStatus="Twitch list unavailable. Emotes can still load from incoming messages.";return;}LearnTwitch(entries.Take(5000).Select(item=>new Emote{Name=Protocol.Pick(item,"name"),Url=Protocol.Pick(item,"imageUrl")}));TwitchStatus="Twitch ready · "+twitch.Count+" emotes · learns from incoming messages";}
 public static Dictionary<string,Emote> ParseSet(object root){var result=new Dictionary<string,Emote>(StringComparer.Ordinal);var entries=Protocol.Items(Protocol.Get(root,"emotes"));if(entries==null)return result;foreach(var item in entries.Take(2000)){string name=Protocol.Pick(item,"name"),host=Protocol.Pick(item,"data.host.url");if(name==""||host=="")continue;if(host.StartsWith("//"))host="https:"+host;var files=Protocol.Items(Protocol.Get(item,"data.host.files"));if(files==null)continue;var usable=files.Where(f=>new[]{"PNG","GIF"}.Contains(Protocol.Pick(f,"format").ToUpperInvariant())).OrderBy(f=>Math.Abs(Number(Protocol.Pick(f,"height"))-64));foreach(var file in usable){string filename=Protocol.Pick(file,"name");if(filename.Contains("/")||filename.Contains(".."))continue;string url=host.TrimEnd('/')+"/"+filename;if(!EmoteCache.Allowed(url))continue;result[name]=new Emote{Name=name,Url=url};break;}}return result;}
 static int Number(string value){int n;return int.TryParse(value,out n)?n:0;}
 public static string SetId(string value){value=(value??"").Trim();if(value=="")return "";Uri uri;if(Uri.TryCreate(value,UriKind.Absolute,out uri)){if(uri.Scheme!="https"||!new[]{"7tv.app","7tv.io"}.Contains(uri.Host))throw new ArgumentException("Use a 7TV emote-set link.");var parts=uri.AbsolutePath.Trim('/').Split('/');if(parts.Length!=2||parts[0]!="emote-sets")throw new ArgumentException("Use the link to an emote set, not an individual emote.");value=parts[1];}if(!Regex.IsMatch(value,"^(?:[a-fA-F0-9]{24}|[0-9A-HJKMNP-TV-Z]{26})$"))throw new ArgumentException("Enter a valid 7TV emote-set link or ID.");return value;}
 async Task<object> Read(string path){using(var response=await http.GetAsync("https://7tv.io/v3/"+path)){if(response.StatusCode==System.Net.HttpStatusCode.NotFound)return null;response.EnsureSuccessStatusCode();return new System.Web.Script.Serialization.JavaScriptSerializer{MaxJsonLength=4194304}.DeserializeObject(await response.Content.ReadAsStringAsync());}}
 public async Task Refresh(string platform,string channelId,string setOverride,Action changed){if(busy||disposed)return;busy=true;Status="Loading 7TV emotes…";changed();try{
  if(Platform!=platform||ChannelId!=channelId||SetOverride!=setOverride)channel.Clear();Platform=platform;ChannelId=channelId;SetOverride=setOverride;
  string globalError="",channelError="";
  if(globals.Count==0)try{var global=await Read("emote-sets/global");if(disposed)return;globals=ParseSet(global);}catch(Exception ex){globalError=EmoteNetwork.Error(ex);}
  if(disposed)return;
  try{object set=null;if(setOverride!="")set=await Read("emote-sets/"+Uri.EscapeDataString(SetId(setOverride)));else if(Regex.IsMatch(channelId??"","^[0-9]+$")&&new[]{"twitch","kick"}.Contains(platform)){var user=await Read("users/"+platform+"/"+channelId);set=Protocol.Get(user,"emote_set");}if(disposed)return;channel=ParseSet(set);}catch(Exception ex){channelError=EmoteNetwork.Error(ex);}
  if(disposed)return;
  await RefreshExtras(platform,channelId);if(disposed)return;
  Status="BTTV + FFZ: "+extraEmotes.Count+" emotes\n7TV: "+channel.Count+" channel emotes + "+globals.Count+" global emotes";
  if(channelError!="")Status+="\nChannel refresh failed: "+channelError;
  if(globalError!="")Status+="\nGlobal refresh failed: "+globalError;
  if(channelError==""&&channel.Count==0)Status+="\nNo active channel set found. Add your 7TV emote-set link.";
 }finally{busy=false;if(!disposed)changed();}}
 public void Dispose(){disposed=true;http.Dispose();}
}

public sealed class MessageRun { public string Text,Url; }
public static class InlineMessage {
 public static List<MessageRun> Resolve(Alert alert,SevenTvCatalog catalog){var names=new Dictionary<string,Emote>(StringComparer.Ordinal);foreach(var emote in alert.Emotes)if(!string.IsNullOrEmpty(emote.Name))names[emote.Name]=emote;var result=new List<MessageRun>();foreach(Match match in Regex.Matches(alert.Detail??"","\\s+|\\S+")){string token=match.Value;Emote emote;if(!names.TryGetValue(token,out emote))emote=catalog==null?null:catalog.Find(token,alert.Platform);string url=emote==null?null:emote.Url;
  if(url==null&&alert.Platform.Equals("Twitch",StringComparison.OrdinalIgnoreCase)&&alert.Kind=="Cheer"){var cheer=Regex.Match(token,"^Cheer([0-9]+)$",RegexOptions.IgnoreCase);long amount;if(cheer.Success&&long.TryParse(cheer.Groups[1].Value,out amount)&&amount>0){long tier=new long[]{1,100,1000,5000,10000}.Last(x=>x<=amount);url="https://d3aqoihi2n8ty8.cloudfront.net/actions/cheer/dark/animated/"+tier+"/2.gif";}}
  result.Add(new MessageRun{Text=token,Url=url});if(result.Count>=4096)break;
 }return result;}
 public static void Draw(Graphics graphics,Font font,Color color,Rectangle bounds,IList<MessageRun> runs,EmoteCache cache,bool wrap,int emoteSize=28){if(runs==null)return;var saved=graphics.Save();graphics.SetClip(bounds,System.Drawing.Drawing2D.CombineMode.Intersect);int x=bounds.Left,y=bounds.Top,line=Math.Max(emoteSize+4,font.Height+5);foreach(var run in runs){var bitmap=run.Url==null?null:cache.Find(run.Url);int width=bitmap==null?TextRenderer.MeasureText(graphics,run.Text,font,new Size(int.MaxValue,int.MaxValue),TextFormatFlags.NoPadding|TextFormatFlags.NoPrefix|TextFormatFlags.SingleLine).Width:Math.Max(16,(int)((double)emoteSize*bitmap.Width/bitmap.Height))+4;bool newline=run.Text.Contains("\n");if(wrap&&(newline||(x+width>bounds.Right&&x>bounds.Left))){x=bounds.Left;y+=line;if(string.IsNullOrWhiteSpace(run.Text))continue;}if(y+line>bounds.Bottom)break;if(!wrap&&x+width>bounds.Right){TextRenderer.DrawText(graphics,"…",font,new Point(Math.Min(x,bounds.Right-16),y+(line-font.Height)/2),color,TextFormatFlags.NoPadding);break;}if(bitmap!=null)graphics.DrawImage(bitmap,new Rectangle(x,y+(line-emoteSize)/2,width-4,emoteSize));else TextRenderer.DrawText(graphics,run.Text,font,new Rectangle(x,y+(line-font.Height)/2,width,line),color,TextFormatFlags.NoPadding|TextFormatFlags.NoPrefix|TextFormatFlags.SingleLine);x+=width;}graphics.Restore(saved);}
}

public sealed class BufferedFeed : ListView {
 public BufferedFeed(){DoubleBuffered=true;}
}

public sealed class MessageView : Control {
 public Alert Alert;public EmoteCache Cache;
 readonly System.Windows.Forms.Timer animation=new System.Windows.Forms.Timer{Interval=80};
 public MessageView(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.Opaque,true);BackColor=Theme.Surface;ForeColor=Theme.Text;animation.Tick+=delegate{if(Visible&&Alert!=null&&Cache!=null&&Alert.Runs.Any(r=>Cache.IsAnimated(r.Url)))Invalidate();};animation.Start();}
 protected override void OnPaint(PaintEventArgs e){e.Graphics.Clear(BackColor);base.OnPaint(e);if(Alert!=null&&Cache!=null)InlineMessage.Draw(e.Graphics,Font,ForeColor,ClientRectangle,Alert.Runs,Cache,true);}
 protected override void Dispose(bool disposing){if(disposing)animation.Dispose();base.Dispose(disposing);}
}

