import { useState, useRef, useEffect } from 'react';
import { supabase, type AdminSettings, type Property, PROPERTY_CATEGORIES, UGANDA_DISTRICTS, DISTRICT_AREAS, COMMON_AMENITIES, HOTEL_AMENITIES, GUEST_HOUSE_FACILITIES, WAREHOUSE_AMENITIES } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { CategoryLogo } from './CategoryLogos';
import LocationPicker from './LocationPicker';

interface ListingFormProps {
  settings: AdminSettings | null;
  onDone: () => void;
  onClose: () => void;
  editProperty?: Property | null;
}

const MAX_PHOTO_MB = 10;
const MAX_VIDEO_MB = 100;

interface UploadedFile {
  url: string;
  name: string;
}

export default function ListingForm({ onDone, onClose, editProperty }: ListingFormProps) {
  const { profile } = useAuth();
  const isEditing = !!editProperty;
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [videos, setVideos] = useState<UploadedFile[]>([]);
  const lastEditProperty = useRef<Property | null>(null);

  useEffect(() => {
    if (!editProperty) {
      lastEditProperty.current = null;
      return;
    }
    if (lastEditProperty.current === editProperty) return;
    lastEditProperty.current = editProperty;
    setCategory(editProperty.category);
    setOwnerName(editProperty.owner_name || profile?.full_name || '');
    setOwnerEmail(editProperty.owner_email || profile?.email || '');
    setPrimaryContact(editProperty.primary_contact || profile?.whatsapp || '');
    setWhatsapp(editProperty.whatsapp || '');
    setTitle(editProperty.title);
    setDescription(editProperty.description || '');
    setPrice(String(editProperty.price || ''));
    setDistrict(editProperty.district || '');
    setArea(editProperty.area || '');
    setCustomArea('');
    setAmenities(editProperty.amenities || []);
    setBeds(String(editProperty.beds || 0));
    setBaths(String(editProperty.baths || 0));
    setRooms(String(editProperty.rooms || 0));
    setStarRating(editProperty.star_rating || 0);
    setCheckInTime(editProperty.check_in_time || '');
    setCheckOutTime(editProperty.check_out_time || '');
    setMinimumStay(editProperty.minimum_stay || '1 night');
    setSeatingCapacity(String(editProperty.seating_capacity || 0));
    setOpeningTime(editProperty.opening_time || '');
    setClosingTime(editProperty.closing_time || '');
    setEntryFee(editProperty.entry_fee ? String(editProperty.entry_fee) : '');
    setMinimumSpend(editProperty.minimum_spend ? String(editProperty.minimum_spend) : '');
    setPhotos((editProperty.photo_urls || []).map((url, i) => ({ url, name: `photo_${i}` })));
    setVideos((editProperty.video_urls || []).map((url, i) => ({ url, name: `video_${i}` })));
    setLat(editProperty.latitude ?? null);
    setLng(editProperty.longitude ?? null);
    setStreetAddress(editProperty.street_address || '');
  }, [editProperty, profile]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Owner/manager details — pre-filled from profile
  const [ownerName, setOwnerName] = useState(profile?.full_name || '');
  const [ownerEmail, setOwnerEmail] = useState(profile?.email || '');
  const [primaryContact, setPrimaryContact] = useState(profile?.whatsapp || '');
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp || '');

  // Common fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [area, setArea] = useState('');
  const [district, setDistrict] = useState('');
  const [customArea, setCustomArea] = useState('');
  const [amenities, setAmenities] = useState<string[]>([]);
  const [beds, setBeds] = useState('0');
  const [baths, setBaths] = useState('0');

  // Hotel-specific
  const [rooms, setRooms] = useState('0');
  const [starRating, setStarRating] = useState(0);
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [minimumStay, setMinimumStay] = useState('1 night');

  // Guest House-specific
  const [seatingCapacity, setSeatingCapacity] = useState('0');
  const [openingTime, setOpeningTime] = useState('');
  const [closingTime, setClosingTime] = useState('');
  const [entryFee, setEntryFee] = useState('');
  const [minimumSpend, setMinimumSpend] = useState('');

  // Map location
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [streetAddress, setStreetAddress] = useState('');

  const isHotel = category === 'Hotels';
  const isShortStay = category === 'Rentals';
  const isGuestHouse = category === 'Guest Houses';
  const isWarehouse = category === 'Warehouses';
  const isHouse = category === 'Houses';
  const isApartment = category === 'Apartments';
  const isAirbnb = category === 'Airbnb';
  const isProperty = isHouse || isApartment;
  const isStayLike = isHotel || isShortStay || isAirbnb;

  function toggleAmenity(a: string) {
    setAmenities((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);
  }

  function getAmenityList(): string[] {
    if (isStayLike) return [...HOTEL_AMENITIES];
    if (isGuestHouse) return [...GUEST_HOUSE_FACILITIES];
    if (isWarehouse) return [...WAREHOUSE_AMENITIES];
    return [...COMMON_AMENITIES];
  }

  function pickCategory(c: string) {
    setCategory(c);
    setAmenities([]);
  }

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || !profile) return;
    const toUpload = Array.from(files);
    if (toUpload.length === 0) return;
    setNotice('');

    const invalid = toUpload.find((f) => !f.type.startsWith('image/') || f.size > MAX_PHOTO_MB * 1024 * 1024);
    if (invalid) {
      setError(`"${invalid.name}" must be an image under ${MAX_PHOTO_MB}MB.`);
      if (photoInputRef.current) photoInputRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      const uploaded: UploadedFile[] = [];
      for (const file of toUpload) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const fileName = `listings/${profile.id}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('listing-media')
          .upload(fileName, file, { cacheControl: '3600', upsert: false });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('listing-media').getPublicUrl(fileName);
        uploaded.push({ url: urlData.publicUrl, name: file.name });
      }
      setPhotos((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo upload failed.');
    } finally {
      setUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  async function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || !profile) return;
    const toUpload = Array.from(files);
    if (toUpload.length === 0) return;
    setNotice('');

    const invalid = toUpload.find((f) => !f.type.startsWith('video/') || f.size > MAX_VIDEO_MB * 1024 * 1024);
    if (invalid) {
      setError(`"${invalid.name}" must be a video under ${MAX_VIDEO_MB}MB.`);
      if (videoInputRef.current) videoInputRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      const uploaded: UploadedFile[] = [];
      for (const file of toUpload) {
        const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
        const fileName = `listings/${profile.id}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('listing-media')
          .upload(fileName, file, { cacheControl: '3600', upsert: false });
        if (upErr) throw upErr;
        const { data: urlData } = supabase.storage.from('listing-media').getPublicUrl(fileName);
        uploaded.push({ url: urlData.publicUrl, name: file.name });
      }
      setVideos((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Video upload failed.');
    } finally {
      setUploading(false);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }
  function removeVideo(idx: number) {
    setVideos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!category) { setError('Please select a category.'); return; }
    if (!profile) { setError('You must be signed in.'); return; }

    let finalTitle = title.trim();
    if (isProperty) {
      const loc = area === '__other__' ? (customArea || district) : (area || district) || 'Uganda';
      finalTitle = `${isApartment ? 'Apartment' : 'House'} in ${loc}`;
    }
    if (!finalTitle) { setError('Please enter a name.'); return; }

    setSubmitting(true);
    try {
      const { data: activeSubs } = await supabase
        .from('subscriptions')
        .select('expiry_date')
        .eq('user_id', profile.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1);

      const nowTime = Date.now();
      const futureDates = [
        activeSubs?.[0]?.expiry_date,
        isEditing ? editProperty?.expires_at : null,
      ]
        .filter((value): value is string => !!value)
        .map((value) => new Date(value).getTime())
        .filter((value) => value > nowTime);

      const expiresAt = futureDates.length > 0
        ? new Date(Math.max(...futureDates)).toISOString()
        : isEditing && editProperty?.expires_at
          ? editProperty.expires_at
          : new Date(nowTime + 30 * 24 * 60 * 60 * 1000).toISOString();

      const basePrice = isGuestHouse
        ? (entryFee ? Number(entryFee) : 0)
        : (price ? Number(price) : 0);

      const contactNumber = whatsapp || primaryContact || profile.whatsapp || '';
      const photoUrls = photos.map((p) => p.url);
      const videoUrls = videos.map((v) => v.url);
      const finalArea = area === '__other__' ? customArea : area;

      const payload = {
        user_id: profile.id,
        category,
        title: finalTitle,
        description: description.trim(),
        price: basePrice,
        area: finalArea,
        district,
        beds: Number(beds) || 0,
        baths: Number(baths) || 0,
        amenities,
        photos_count: photoUrls.length,
        videos_count: videoUrls.length,
        photo_urls: photoUrls,
        video_urls: videoUrls,
        whatsapp: contactNumber,
        status: isEditing && editProperty ? editProperty.status : 'available',
        expires_at: expiresAt,
        owner_name: ownerName,
        owner_email: ownerEmail,
        primary_contact: primaryContact || contactNumber,
        rooms: Number(rooms),
        star_rating: starRating,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        minimum_stay: minimumStay,
        seating_capacity: Number(seatingCapacity),
        opening_time: openingTime,
        closing_time: closingTime,
        entry_fee: entryFee ? Number(entryFee) : 0,
        minimum_spend: minimumSpend ? Number(minimumSpend) : 0,
        latitude: lat,
        longitude: lng,
        street_address: streetAddress,
      };

      let opError;
      if (isEditing && editProperty) {
        ({ error: opError } = await supabase.from('properties').update(payload).eq('id', editProperty.id));
      } else {
        ({ error: opError } = await supabase.from('properties').insert(payload));
      }

      if (opError) throw opError;
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (!isEditing && /row-level security/i.test(message)) {
        setError('Could not publish this listing. Please make sure you are signed in and try again.');
      } else {
        setError(message || (isEditing ? 'Failed to update listing.' : 'Failed to create listing.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const headerLabel = isEditing
    ? 'Edit Listing'
    : isGuestHouse
      ? ' Register Your Guest House'
      : isHotel
        ? ' Register Your Hotel'
        : isShortStay
          ? ' Register Your Rental'
          : isWarehouse
            ? ' Register Your Warehouse'
      : isAirbnb
        ? ' Register Your Airbnb'
      : isApartment
              ? ' Register Your Apartment'
              : isHouse
                ? ' Register Your House'
                : 'Create a Listing';

  const reachLabel = isGuestHouse
    ? 'Clients will reach you on WhatsApp'
    : isHotel
      ? 'Guests will reach you on WhatsApp'
      : isShortStay
        ? 'Guests will reach you on WhatsApp'
        : isAirbnb
          ? 'Guests will reach you on WhatsApp'
          : isWarehouse
            ? 'Clients will reach you on WhatsApp'
            : 'Clients will reach you on WhatsApp';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '680px' }} onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}></button>
        <h3 style={{ marginBottom: '4px' }}>{headerLabel}</h3>
        <div className="modal-sub">{isEditing ? 'Update your listing details, photos, and videos below.' : 'Fill in the details below to publish your listing.'}</div>
        {error && <div className="auth-err" style={{ marginTop: '12px' }}>{error}</div>}
        {notice && (
          <div style={{ background: '#FEF3C7', color: '#92400E', borderRadius: '8px', padding: '8px 12px', fontSize: '12px', fontWeight: 600, marginTop: '12px' }}>
            {notice}
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ marginTop: '8px' }}>
          {/* Step 1: Choose category */}
          <div className="section-divider">Step 1 — What do you want to list?</div>
          <div className="category-grid">
            {PROPERTY_CATEGORIES.map((c) => (
              <div
                key={c}
                className={`category-btn ${category === c ? 'selected' : ''}`}
                onClick={() => pickCategory(c)}
                style={{ flexDirection: 'column', gap: '8px' }}
              >
                <CategoryLogo category={c} size={44} />
                <div className="cat-name">{c}</div>
              </div>
            ))}
          </div>

          {category && (
            <>
              {/* Owner/Manager details */}
              <div className="section-divider">
                {isHotel || isGuestHouse || isShortStay || isWarehouse || isAirbnb ? 'Owner / Host details' : 'Your Details'}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>
                    Full Name
                    {isProperty && <span className="opt"> (optional)</span>}
                  </label>
                  <input
                    type="text"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="Your full name"
                    required={!isProperty}
                  />
                </div>
                <div className="form-group">
                  <label>Email <span className="opt">(optional)</span></label>
                  <input
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Primary contact</label>
                  <input
                    type="tel"
                    value={primaryContact}
                    onChange={(e) => setPrimaryContact(e.target.value)}
                    placeholder="e.g. 0772 123 456"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>WhatsApp <span className="opt">(secondary)</span></label>
                  <input
                    type="tel"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="e.g. 0772 123 456"
                  />
                </div>
              </div>
              <div style={{ fontSize: '12px', color: '#25D366', fontWeight: 600, marginBottom: '14px' }}>
                 {reachLabel}
              </div>

              {/* Details section */}
              <div className="section-divider">
                {isGuestHouse ? 'Guest House details' : isHotel ? 'Hotel details' : isShortStay ? 'Rental details' : isWarehouse ? 'Warehouse details' : isAirbnb ? 'Airbnb details' : 'Property Details'}
              </div>

              {(isHotel || isGuestHouse || isShortStay || isWarehouse || isAirbnb) && (
                <div className="form-group">
                  <label>{isGuestHouse ? 'Guest House name' : isHotel ? 'Hotel name' : isWarehouse ? 'Warehouse name' : isAirbnb ? 'Airbnb name' : 'Rental name'}</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={isGuestHouse ? 'e.g. Kampala Guest House' : isHotel ? 'e.g. Grand Hotel Kampala' : isWarehouse ? 'e.g. Industrial Warehouse Namanve' : isAirbnb ? 'e.g. Modern Apartment in Kololo' : 'e.g. Cozy Studio in Ntinda'}
                    required
                  />
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>District</label>
                  <select
                    value={district}
                    onChange={(e) => { setDistrict(e.target.value); setArea(''); setCustomArea(''); }}
                    required
                  >
                    <option value="">Select district</option>
                    {UGANDA_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Specific Area</label>
                  {district && DISTRICT_AREAS[district] ? (
                    <>
                      <select
                        value={area === '__other__' ? '__other__' : area}
                        onChange={(e) => {
                          if (e.target.value === '__other__') {
                            setArea('__other__');
                            setCustomArea('');
                          } else {
                            setArea(e.target.value);
                            setCustomArea('');
                          }
                        }}
                      >
                        <option value="">Select area in {district}</option>
                        {DISTRICT_AREAS[district].map((a) => <option key={a} value={a}>{a}</option>)}
                        <option value="__other__">Other (type your own)</option>
                      </select>
                      {area === '__other__' && (
                        <input
                          type="text"
                          value={customArea}
                          onChange={(e) => setCustomArea(e.target.value)}
                          placeholder="Type your specific area..."
                          style={{ marginTop: '6px' }}
                        />
                      )}
                    </>
                  ) : (
                    <input
                      type="text"
                      value={customArea}
                      onChange={(e) => setCustomArea(e.target.value)}
                      placeholder={district ? "Type your specific area..." : "Select district first"}
                      disabled={!district}
                    />
                  )}
                </div>
              </div>

              {isProperty && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Bedrooms</label>
                    <input
                      type="number"
                      value={beds}
                      onChange={(e) => setBeds(e.target.value)}
                      min="0"
                      placeholder="e.g. 3"
                    />
                  </div>
                  <div className="form-group">
                    <label>Bathrooms</label>
                    <input
                      type="number"
                      value={baths}
                      onChange={(e) => setBaths(e.target.value)}
                      min="0"
                      placeholder="e.g. 2"
                    />
                  </div>
                </div>
              )}

              {(isHotel || isShortStay || isAirbnb) && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Number of rooms</label>
                    <input
                      type="number"
                      value={rooms}
                      onChange={(e) => setRooms(e.target.value)}
                      min="0"
                      placeholder="e.g. 50"
                    />
                  </div>
                  <div className="form-group">
                    <label>Star rating</label>
                    <div className="star-row">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <span
                          key={s}
                          className={`star-btn ${s <= starRating ? 'lit' : ''}`}
                          onClick={() => setStarRating(s)}
                        >
                          
                        </span>
                      ))}
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' }}>Tap to rate</span>
                    </div>
                  </div>
                </div>
              )}

              {isGuestHouse && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Seating capacity</label>
                    <input
                      type="number"
                      value={seatingCapacity}
                      onChange={(e) => setSeatingCapacity(e.target.value)}
                      min="0"
                      placeholder="e.g. 100"
                    />
                  </div>
                  <div className="form-group">
                    <label>Opening time</label>
                    <input
                      type="time"
                      value={openingTime}
                      onChange={(e) => setOpeningTime(e.target.value)}
                    />
                  </div>
                </div>
              )}
              {isGuestHouse && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Closing time</label>
                    <input
                      type="time"
                      value={closingTime}
                      onChange={(e) => setClosingTime(e.target.value)}
                    />
                  </div>
                </div>
              )}
              {isWarehouse && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Size (sqm)</label>
                    <input
                      type="number"
                      value={rooms}
                      onChange={(e) => setRooms(e.target.value)}
                      min="0"
                      placeholder="e.g. 500"
                    />
                  </div>
                  <div className="form-group">
                    <label>Type</label>
                    <select value={minimumStay} onChange={(e) => setMinimumStay(e.target.value)}>
                      <option>General Storage</option>
                      <option>Cold Storage</option>
                      <option>Industrial</option>
                      <option>Distribution</option>
                      <option>Manufacturing</option>
                    </select>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>
                  Describe the {isGuestHouse ? 'guest house' : isHotel ? 'hotel' : isShortStay ? 'rental' : isWarehouse ? 'warehouse' : isAirbnb ? 'Airbnb' : isApartment ? 'apartment' : 'house'}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    isGuestHouse
                      ? 'Describe the guest house, rooms, services...'
                      : isHotel
                        ? 'Describe your hotel, services, location...'
                        : isShortStay
                          ? 'Describe the space, amenities, location, check-in process...'
                        : isAirbnb
                          ? 'Describe your Airbnb space, amenities, location, check-in process...'
                        : isWarehouse
                            ? 'Describe the warehouse, size, access, facilities...'
                            : 'Describe the property, features, surroundings...'
                  }
                />
              </div>

              {/* Pin Location on Map */}
              <div className="section-divider">Pin Location on Map</div>
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: 1.5 }}>
                Help visitors find your property. Search for your area, click on the map to drop a pin, or use your current location.
                Visitors will be able to get live directions to this spot.
              </div>
              <LocationPicker
                latitude={lat}
                longitude={lng}
                streetAddress={streetAddress}
                onLocationChange={(newLat, newLng) => { setLat(newLat); setLng(newLng); }}
                onStreetAddressChange={setStreetAddress}
              />

              {category && (
                <>
                  <div className="section-divider">
                    {isGuestHouse ? 'Facilities & services' : 'Amenities'}
                  </div>
                  <div className="amenity-checkboxes">
                    {getAmenityList().map((a) => (
                      <div
                        key={a}
                        className={`amenity-check ${amenities.includes(a) ? 'on' : ''}`}
                        onClick={() => toggleAmenity(a)}
                      >
                        {a}
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="section-divider">Pricing</div>
              {isProperty && (
                <div className="form-group">
                  <label>Monthly rent (UGX)</label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="e.g. 850000"
                    min="0"
                  />
                </div>
              )}
              {isWarehouse && (
                <div className="form-group">
                  <label>Monthly rent (UGX)</label>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="e.g. 5000000"
                    min="0"
                  />
                </div>
              )}
              {(isHotel || isShortStay || isAirbnb) && (
                <>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Price per night (UGX)</label>
                      <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        min="0"
                        placeholder="e.g. 180000"
                      />
                    </div>
                    <div className="form-group">
                      <label>Check-in time</label>
                      <input
                        type="time"
                        value={checkInTime}
                        onChange={(e) => setCheckInTime(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Check-out time</label>
                      <input
                        type="time"
                        value={checkOutTime}
                        onChange={(e) => setCheckOutTime(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Minimum stay</label>
                      <select value={minimumStay} onChange={(e) => setMinimumStay(e.target.value)}>
                        <option>1 night</option>
                        <option>2 nights</option>
                        <option>3 nights</option>
                        <option>1 week</option>
                      </select>
                    </div>
                  </div>
                </>
              )}
              {isGuestHouse && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Entry fee (UGX) <span className="opt">(if any)</span></label>
                    <input
                      type="number"
                      value={entryFee}
                      onChange={(e) => setEntryFee(e.target.value)}
                      min="0"
                      placeholder="e.g. 20000"
                    />
                  </div>
                  <div className="form-group">
                    <label>Minimum spend (UGX) <span className="opt">(if any)</span></label>
                    <input
                      type="number"
                      value={minimumSpend}
                      onChange={(e) => setMinimumSpend(e.target.value)}
                      min="0"
                      placeholder="e.g. 50000"
                    />
                  </div>
                </div>
              )}

              {/* Photos & Videos — real uploads */}
              <div className="section-divider">Photos & Videos</div>

              {/* Photo upload */}
              <div className="form-group">
                <label>
                   Photos ({photos.length})
                </label>
                <div className="upload-area">
                  {photos.map((p, idx) => (
                    <div key={idx} className="upload-thumb">
                      <img src={p.url} alt={`Photo ${idx + 1}`} />
                      <button type="button" className="upload-remove" onClick={() => removePhoto(idx)}></button>
                    </div>
                  ))}
                  <div
                    className="upload-add"
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <span style={{ fontSize: '28px' }}>+</span>
                    <span style={{ fontSize: '11px' }}>Add Photo</span>
                  </div>
                </div>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handlePhotoSelect}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Unlimited images — JPG, PNG, WebP (max {MAX_PHOTO_MB}MB each)
                </div>
              </div>

              {/* Video upload */}
              <div className="form-group">
                <label>
                   Videos ({videos.length})
                </label>
                <div className="upload-area">
                  {videos.map((v, idx) => (
                    <div key={idx} className="upload-thumb video-thumb">
                      <video src={v.url} />
                      <button type="button" className="upload-remove" onClick={() => removeVideo(idx)}></button>
                      <span className="video-badge">VIDEO</span>
                    </div>
                  ))}
                  <div
                    className="upload-add"
                    onClick={() => videoInputRef.current?.click()}
                  >
                    <span style={{ fontSize: '28px' }}>+</span>
                    <span style={{ fontSize: '11px' }}>Add Video</span>
                  </div>
                </div>
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleVideoSelect}
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Unlimited videos — MP4, WebM, MOV (max {MAX_VIDEO_MB}MB each)
                </div>
              </div>

              {uploading && (
                <div style={{ fontSize: '13px', color: 'var(--navy)', fontWeight: 600, marginBottom: '12px' }}>
                  Uploading files... please wait.
                </div>
              )}

              <button type="submit" className="submit-btn green-btn" disabled={submitting || uploading}>
                {submitting
                  ? (isEditing ? 'Saving...' : 'Publishing...')
                  : isEditing
                    ? 'Save Changes'
                    : `Publish ${isGuestHouse ? 'Guest House' : isHotel ? 'Hotel' : isShortStay ? 'Rental' : isWarehouse ? 'Warehouse' : isApartment ? 'Apartment' : 'House'}`}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
